use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, VecDeque},
    io::{self, BufRead, Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
};

const HISTORY_BYTES: usize = 2 * 1024 * 1024;
const MAX_FRAME: usize = 1_048_576;
#[derive(Default)]
struct Output {
    bytes: VecDeque<u8>,
    end: u64,
}
impl Output {
    fn push(&mut self, bytes: &[u8]) {
        self.end += bytes.len() as u64;
        self.bytes.extend(bytes);
        let excess = self.bytes.len().saturating_sub(HISTORY_BYTES);
        self.bytes.drain(..excess);
    }
    fn read(&self, cursor: u64) -> Value {
        let start = self.end - self.bytes.len() as u64;
        let from = cursor.max(start).min(self.end);
        let data: Vec<u8> = self
            .bytes
            .iter()
            .skip((from - start) as usize)
            .take(16384)
            .copied()
            .collect();
        json!({"data":STANDARD.encode(&data),"cursor":from+data.len() as u64,"end":self.end,"truncated":cursor<start})
    }
}
#[cfg(windows)]
struct Job(winapi::um::winnt::HANDLE);
#[cfg(windows)]
impl Job {
    fn attach(child: &dyn Child) -> Result<Self, String> {
        use winapi::um::{jobapi2::*, winnt::*};
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if handle.is_null() {
                return Err(io::Error::last_os_error().to_string());
            }
            let job = Self(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let process = child.as_raw_handle().ok_or("process handle unavailable")?;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&mut limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, process.cast()) == 0
            {
                return Err(io::Error::last_os_error().to_string());
            }
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            winapi::um::handleapi::CloseHandle(self.0);
        }
    }
}
struct Terminal {
    id: String,
    shell: String,
    error: Option<String>,
    exit: Option<u32>,
    child: Option<Box<dyn Child + Send + Sync>>,
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    output: Arc<Mutex<Output>>,
    guardian: Option<std::process::Child>,
    #[cfg(windows)]
    job: Option<Job>,
}
impl Terminal {
    fn alive(&mut self) -> bool {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    self.exit = Some(status.exit_code());
                    self.child = None;
                    self.stop();
                }
                Err(error) => {
                    self.error = Some(error.to_string());
                    self.stop();
                }
                _ => {}
            }
        }
        self.child.is_some()
    }
    fn stop(&mut self) {
        #[cfg(windows)]
        {
            self.job = None;
        }
        // Closing the guardian pipe triggers tree cleanup even if this backend crashes.
        if let Some(mut guardian) = self.guardian.take() {
            drop(guardian.stdin.take());
            let _ = guardian.wait();
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.writer = None;
        self.master = None;
    }
    fn info(&mut self) -> Value {
        let running = self.alive();
        #[cfg(unix)]
        let foreground = self.master.as_ref().and_then(|v| v.process_group_leader());
        #[cfg(windows)]
        let foreground: Option<i32> = None;
        json!({"id":self.id,"shell":self.shell,"running":running,"exitCode":self.exit,"error":self.error,"pid":self.child.as_ref().and_then(|v|v.process_id()),"foreground":foreground})
    }
}
impl Drop for Terminal {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(unix)]
fn cleanup_tree(root: u32) {
    // A PTY session survives reparenting when the shell dies before the watchdog.
    let output = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid="])
        .output();
    let mut pids = Vec::new();
    if let Ok(output) = output {
        for pid in String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .filter_map(|v| v.parse::<i32>().ok())
        {
            if unsafe { libc::getsid(pid) } == root as i32 {
                pids.push(pid);
            }
        }
    }
    // Preserve cleanup of the initial group even if enumeration is unavailable.
    unsafe {
        libc::kill(-(root as i32), libc::SIGKILL);
    }
    for pid in pids {
        if unsafe { libc::getsid(pid) } == root as i32 {
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
    }
}
#[cfg(windows)]
fn cleanup_tree(root: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &root.to_string(), "/T", "/F"])
        .output();
}
fn guardian(root: u32) {
    let mut input = io::stdin();
    let mut byte = [0u8; 1];
    while matches!(input.read(&mut byte),Ok(n) if n>0) {}
    cleanup_tree(root);
}

#[cfg(unix)]
fn default_shell() -> Result<(String, Vec<String>), String> {
    let mut record: libc::passwd = unsafe { std::mem::zeroed() };
    let mut result = std::ptr::null_mut();
    let mut buffer = vec![0u8; 65536];
    let status = unsafe {
        libc::getpwuid_r(
            libc::getuid(),
            &mut record,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() || record.pw_shell.is_null() {
        return Err(
            "无法识别用户登录 shell，请设置 shell 路径。 / Cannot resolve login shell.".into(),
        );
    }
    let shell = unsafe { std::ffi::CStr::from_ptr(record.pw_shell) }
        .to_string_lossy()
        .into_owned();
    if shell.is_empty() {
        return Err("用户登录 shell 为空，请手动选择。 / Login shell is empty.".into());
    }
    let name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    let args = if ["bash", "zsh", "fish", "sh", "ksh"].contains(&name) {
        vec!["-l".into()]
    } else {
        vec![]
    };
    Ok((shell, args))
}
#[cfg(windows)]
fn default_shell() -> Result<(String, Vec<String>), String> {
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or("LOCALAPPDATA unavailable")?;
    for file in [
        local.join("Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json"),
        local.join("Microsoft/Windows Terminal/settings.json"),
        local.join(
            "Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json",
        ),
    ] {
        if !file.is_file() {
            continue;
        }
        let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
        let config: Value = json5::from_str(&text).map_err(|e| e.to_string())?;
        let default = config["defaultProfile"]
            .as_str()
            .ok_or("Windows Terminal defaultProfile missing")?;
        let profile = config["profiles"]["list"]
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|p| p["guid"] == default || p["name"] == default)
            })
            .ok_or("默认 profile 无法解析，请设置本机 shell。 / Default profile unavailable.")?;
        if profile["source"]
            .as_str()
            .is_some_and(|source| source != "Windows.Terminal.PowershellCore")
        {
            return Err("首版仅自动识别本机 shell，请手动选择。 / Select a local shell.".into());
        }
        if let Some(command) = profile["commandline"]
            .as_str()
            .or_else(|| config["profiles"]["defaults"]["commandline"].as_str())
        {
            let parts = split_windows_command(command)?;
            if let Some(shell) = parts.first() {
                let name = std::path::Path::new(shell)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase();
                if ["wsl", "wsl.exe", "ssh", "ssh.exe", "wt", "wt.exe"].contains(&name.as_str()) {
                    return Err("请选择本机 shell；不自动启动 WSL 或远程 profile。".into());
                }
                return Ok((shell.clone(), parts[1..].to_vec()));
            }
        }
        if profile["source"] == "Windows.Terminal.PowershellCore" {
            return Ok(("pwsh.exe".into(), vec![]));
        }
        return Err("默认 profile 未声明可识别的命令，请设置 shell。".into());
    }
    Err(
        "未找到 Windows Terminal 默认 profile，请设置本机 shell 路径。 / Configure a local shell."
            .into(),
    )
}
// Windows command lines are not shell scripts. Preserve quoted executable/argument boundaries.
#[cfg(any(windows, test))]
fn split_windows_command(value: &str) -> Result<Vec<String>, String> {
    let mut args = vec![];
    let mut arg = String::new();
    let mut quoted = false;
    let mut started = false;
    let mut chars = value.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            let mut count = 1;
            while chars.peek() == Some(&'\\') {
                chars.next();
                count += 1;
            }
            if chars.peek() == Some(&'"') {
                arg.extend(std::iter::repeat_n('\\', count / 2));
                if count % 2 == 0 {
                    quoted = !quoted;
                } else {
                    arg.push('"');
                }
                chars.next();
            } else {
                arg.extend(std::iter::repeat_n('\\', count));
            }
            started = true;
        } else if c == '"' {
            quoted = !quoted;
            started = true;
        } else if c.is_whitespace() && !quoted {
            if started {
                args.push(std::mem::take(&mut arg));
                started = false;
            }
        } else {
            arg.push(c);
            started = true;
        }
    }
    if quoted {
        return Err("Unterminated quote in default shell command".into());
    }
    if started {
        args.push(arg);
    }
    Ok(args)
}

struct Backend {
    cwd: PathBuf,
    settings_path: PathBuf,
    settings: Value,
    terminals: BTreeMap<String, Terminal>,
    serial: u64,
}
impl Backend {
    fn new() -> Self {
        let settings_path = std::env::var_os("AIBO_TOOL_SETTINGS")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("shell.json");
        let settings = std::fs::read(&settings_path)
            .ok()
            .and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or(Value::Null);
        Self {
            cwd: std::env::current_dir().unwrap(),
            settings_path,
            settings,
            terminals: BTreeMap::new(),
            serial: 0,
        }
    }
    fn shell(&mut self) -> Result<(String, Vec<String>), String> {
        self.settings = match std::fs::read(&self.settings_path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid shell settings: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Value::Null,
            Err(e) => return Err(e.to_string()),
        };
        if let Some(path) = self.settings["path"].as_str().filter(|v| !v.is_empty()) {
            let args = self.settings["args"]
                .as_array()
                .ok_or("shell arguments must be an array")?
                .iter()
                .map(|v| {
                    v.as_str()
                        .map(String::from)
                        .ok_or_else(|| "shell argument must be a string".into())
                })
                .collect::<Result<Vec<_>, String>>()?;
            Ok((path.into(), args))
        } else {
            default_shell()
        }
    }
    fn create(&mut self, params: &Value) -> Result<Value, String> {
        if self.terminals.len() >= 16 {
            return Err("最多打开 16 个终端 / Maximum 16 terminals".into());
        }
        self.serial += 1;
        let id = self.serial.to_string();
        let mut terminal = Terminal {
            id: id.clone(),
            shell: String::new(),
            error: None,
            exit: None,
            child: None,
            master: None,
            writer: None,
            output: Arc::new(Mutex::new(Output::default())),
            guardian: None,
            #[cfg(windows)]
            job: None,
        };
        let result = (|| -> Result<(), String> {
            let (shell, args) = self.shell()?;
            terminal.shell = shell.clone();
            let pair = native_pty_system()
                .openpty(size(params)?)
                .map_err(|e| e.to_string())?;
            let mut command = CommandBuilder::new(&shell);
            command.args(&args);
            command.cwd(&self.cwd);
            command.env("TERM", "xterm-256color");
            command.env("COLORTERM", "truecolor");
            let child = pair
                .slave
                .spawn_command(command)
                .map_err(|e| e.to_string())?;
            let pid = child.process_id().ok_or("shell process ID unavailable")?;
            terminal.child = Some(child);
            #[cfg(windows)]
            {
                terminal.job = Some(Job::attach(terminal.child.as_ref().unwrap().as_ref())?);
            }
            #[cfg(unix)]
            {
                // Dedicated watchdog inherits a pipe only the backend owns; EOF also covers backend crashes.
                let guardian =
                    std::process::Command::new(std::env::current_exe().map_err(|e| e.to_string())?)
                        .args(["--guardian", &pid.to_string()])
                        .stdin(std::process::Stdio::piped())
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .spawn()
                        .map_err(|e| e.to_string())?;
                terminal.guardian = Some(guardian);
            }
            let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
            terminal.writer = Some(pair.master.take_writer().map_err(|e| e.to_string())?);
            terminal.master = Some(pair.master);
            drop(pair.slave);
            let output = terminal.output.clone();
            std::thread::spawn(move || {
                let mut buffer = [0u8; 8192];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => output.lock().unwrap().push(&buffer[..n]),
                    }
                }
            });
            Ok(())
        })();
        if let Err(error) = result {
            terminal.stop();
            terminal.error = Some(error);
        }
        let info = terminal.info();
        self.terminals.insert(id, terminal);
        Ok(info)
    }
    fn request(&mut self, params: Value) -> Result<Value, String> {
        match params["action"].as_str().ok_or("missing action")? {
            "list" => Ok(
                json!({"terminals":self.terminals.values_mut().map(Terminal::info).collect::<Vec<_>>(),"settings":self.settings,"fresh":self.serial==0}),
            ),
            "create" => self.create(&params),
            "settings" => {
                let settings = &params["settings"];
                if !settings.is_null() {
                    let path = settings["path"].as_str().ok_or("shell path required")?;
                    let args = settings["args"]
                        .as_array()
                        .ok_or("arguments must be an array")?;
                    if path.is_empty()
                        || path.len() > 4096
                        || path.contains('\0')
                        || args.len() > 32
                        || args.iter().any(|a| {
                            a.as_str()
                                .is_none_or(|v| v.len() > 4096 || v.contains('\0'))
                        })
                    {
                        return Err("invalid shell settings".into());
                    }
                }
                let temp = self
                    .settings_path
                    .with_extension(format!("{}.tmp", std::process::id()));
                std::fs::write(&temp, serde_json::to_vec(settings).unwrap())
                    .map_err(|e| e.to_string())?;
                std::fs::rename(temp, &self.settings_path).map_err(|e| e.to_string())?;
                self.settings = settings.clone();
                Ok(Value::Null)
            }
            "read" => {
                let cursors = &params["cursors"];
                let mut updates = vec![];
                for terminal in self.terminals.values_mut() {
                    let info = terminal.info();
                    let chunk = terminal
                        .output
                        .lock()
                        .unwrap()
                        .read(cursors[&terminal.id].as_u64().unwrap_or(0));
                    updates.push(json!({"info":info,"output":chunk}));
                }
                Ok(json!(updates))
            }
            action => {
                let id = params["id"].as_str().ok_or("terminal id required")?;
                let terminal = self
                    .terminals
                    .get_mut(id)
                    .ok_or("terminal no longer exists")?;
                match action {
                    "input" => {
                        if !terminal.alive() {
                            return Err("shell has exited".into());
                        }
                        let data = params["data"].as_str().ok_or("input required")?;
                        if data.len() > 65536 {
                            return Err("input too large".into());
                        }
                        terminal
                            .writer
                            .as_mut()
                            .ok_or("shell has exited")?
                            .write_all(data.as_bytes())
                            .map_err(|e| e.to_string())?;
                        Ok(Value::Null)
                    }
                    "resize" => {
                        if let Some(master) = terminal.master.as_ref() {
                            master.resize(size(&params)?).map_err(|e| e.to_string())?;
                        }
                        Ok(Value::Null)
                    }
                    "close" => {
                        self.terminals.remove(id);
                        Ok(Value::Null)
                    }
                    _ => Err("unknown terminal action".into()),
                }
            }
        }
    }
}
fn size(value: &Value) -> Result<PtySize, String> {
    let rows = value["rows"].as_u64().unwrap_or(24);
    let cols = value["cols"].as_u64().unwrap_or(80);
    if !(2..=500).contains(&rows) || !(2..=500).contains(&cols) {
        return Err("invalid terminal dimensions".into());
    }
    Ok(PtySize {
        rows: rows as u16,
        cols: cols as u16,
        pixel_width: 0,
        pixel_height: 0,
    })
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--guardian") {
        if let Some(pid) = args.get(2).and_then(|v| v.parse().ok()) {
            guardian(pid);
        }
        return;
    }
    let mut backend = Backend::new();
    let input = io::stdin();
    let mut input = input.lock();
    let mut stdout = io::stdout().lock();
    loop {
        let mut frame = Vec::new();
        let mut bounded = (&mut input).take((MAX_FRAME + 1) as u64);
        match bounded.read_until(b'\n', &mut frame) {
            Ok(0) | Err(_) => break,
            Ok(_) if frame.len() > MAX_FRAME => break,
            _ => {}
        }
        let mut stop = false;
        let result=serde_json::from_slice::<Value>(&frame).map_err(|e|e.to_string()).and_then(|message| {
            if message["protocol"]!="aibo.tool-view/1" {return Err("unsupported protocol".into());}
            match message["method"].as_str() {
                Some("initialize") => {let cwd=message["params"]["workspacePath"].as_str().ok_or("workspace path required")?;if !std::path::Path::new(cwd).is_dir() {return Err("workspace directory missing".into());}backend.cwd=PathBuf::from(cwd);Ok(json!({"protocol":"aibo.tool-view/1"}))},
                Some("status") => Ok(json!({"active":backend.terminals.values_mut().map(|v|usize::from(v.alive())).sum::<usize>()})),
                Some("request") => backend.request(message["params"].clone()),
                Some("shutdown") => {backend.terminals.clear();stop=true;Ok(Value::Null)},
                _=>Err("unknown method".into())
            }
        });
        let response = match result {
            Ok(result) => json!({"protocol":"aibo.tool-view/1","result":result}),
            Err(error) => json!({"protocol":"aibo.tool-view/1","error":error}),
        };
        if writeln!(stdout, "{response}")
            .and_then(|_| stdout.flush())
            .is_err()
            || stop
        {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_is_bounded_and_reports_gaps() {
        let mut output = Output::default();
        output.push(&vec![42; HISTORY_BYTES + 4]);
        let result = output.read(0);
        assert_eq!(result["truncated"], true);
        assert_eq!(result["cursor"], 16388);
        assert_eq!(output.bytes.len(), HISTORY_BYTES);
    }
    #[test]
    fn windows_quotes_preserve_argument_boundaries() {
        assert_eq!(
            split_windows_command(
                r#""C:\Program Files\PowerShell\pwsh.exe" -NoLogo "hello world""#
            )
            .unwrap(),
            vec![
                r"C:\Program Files\PowerShell\pwsh.exe",
                "-NoLogo",
                "hello world"
            ]
        );
        assert!(split_windows_command("\"broken").is_err());
    }
    #[test]
    fn dimensions_reject_unbounded_values() {
        assert!(size(&json!({"cols":65536})).is_err());
        assert!(size(&json!({"rows":0})).is_err());
    }
}
