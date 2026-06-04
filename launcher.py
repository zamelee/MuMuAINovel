#!/usr/bin/env python
"""MuMuAINovel Launcher - Triple-pane log monitor"""
import sys, os, re, subprocess, threading, queue, time, atexit
import tkinter as tk
from tkinter import ttk, messagebox

import psutil

if sys.stdout:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
os.environ["PYTHONIOENCODING"] = "utf-8"

if getattr(sys, "frozen", False):
    BASE = os.path.dirname(sys.executable)
else:
    BASE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(BASE, "backend")
FRONTEND = os.path.join(BASE, "frontend")
PYTHON = os.path.join(BACKEND, ".venv", "Scripts", "python.exe")

BACKEND_CMD = [PYTHON, "-u", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
if sys.platform == "win32":
    FRONTEND_CMD = ["npm.cmd", "run", "dev"]
else:
    FRONTEND_CMD = ["npm", "run", "dev"]

# --- Colors ---
COLORS = {
    "win_bg": "#0f0f14", "toolbar_bg": "#16161e", "sash": "#2a2a3a",
    "panel_bg": "#12121a", "panel_header_bg": "#1a1a28", "panel_header_fg": "#a0a0b8",
    "text_bg": "#0d0d15", "text_fg": "#c8c8d4", "text_cursor": "#ffffff",
    "status_running": "#7ec87e", "status_stopped": "#5a5a6e",
    "btn_bg": "#222233", "btn_fg": "#c8c8d4", "btn_active": "#2a2a40",
}

TAG_COLORS = {
    "ERROR": "#ff6666", "WARN": "#e5a040", "INFO": "#b0b0c0",
    "DEBUG": "#6a6a7a", "SUCCESS": "#66cc88", "VITE": "#a78bfa",
    "BACKEND": "#60a5fa", "TIME": "#4a4a58",
    "LLM_SEND": "#f0a060", "LLM_RECV": "#38bdf8", "LLM_TOKEN": "#6a6a7a",
}

LLM_SEND_LOG = os.path.join(BASE, "backend", "app", "logs", "llm_send.log")
LLM_RECV_LOG = os.path.join(BASE, "backend", "app", "logs", "llm_recv.log")
GUARD_PORTS = [(8000, "Backend"), (5173, "Frontend")]


def _find_pids_on_port(port):
    pids = set()
    try:
        for conn in psutil.net_connections(kind="inet"):
            if conn.status == "LISTEN" and conn.laddr.port == port and conn.pid:
                pids.add(conn.pid)
    except Exception:
        pass
    return pids


def _kill_pids_psutil(pids, timeout=5):
    survivors = set()
    for pid in pids:
        try:
            proc = psutil.Process(pid)
            for child in proc.children(recursive=True):
                try:
                    child.kill()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            proc.kill()
            proc.wait(timeout=timeout)
        except psutil.NoSuchProcess:
            pass
        except (psutil.TimeoutExpired, psutil.AccessDenied):
            survivors.add(pid)
        except Exception:
            survivors.add(pid)
    return survivors


def _kill_pids_force(panel, port, pids):
    panel.append("Port {} occupied (PID:{}) - killing".format(port, ",".join(map(str, pids))), "WARN")
    survivors = _kill_pids_psutil(pids)
    if survivors:
        for pid in list(survivors):
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)],
                              capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=8)
            except Exception:
                pass
        time.sleep(2)
        still_alive = {pid for pid in pids if psutil.pid_exists(pid)}
        if still_alive:
            panel.append("FAILED: cannot kill {} - try admin mode".format(",".join(map(str, still_alive))), "ERROR")
            return False
    panel.append("Port {} freed".format(port), "SUCCESS")
    return True


class LogPanel(ttk.Frame):
    def __init__(self, parent, title, accent, wrap_mode="word", show_hscroll=False, **kw):
        super().__init__(parent, **kw)
        self.configure(style="Panel.TFrame")
        header = tk.Frame(self, bg=COLORS["panel_header_bg"], height=28)
        header.pack(fill="x")
        header.pack_propagate(False)
        dot = tk.Label(header, text=" \u25cf", fg=accent, bg=COLORS["panel_header_bg"], font=("Consolas", 10, "bold"))
        dot.pack(side="left", padx=(6, 0))
        tk.Label(header, text=title, fg=COLORS["panel_header_fg"], bg=COLORS["panel_header_bg"],
                font=("Segoe UI", 9, "bold")).pack(side="left", padx=2)
        self.wrap_var = tk.BooleanVar(value=(wrap_mode == "word"))
        cb = tk.Checkbutton(header, text="Wrap", variable=self.wrap_var,
                           command=self._toggle_wrap, bg=COLORS["panel_header_bg"],
                           fg=COLORS["panel_header_fg"], selectcolor=COLORS["panel_bg"],
                           font=("Segoe UI", 7), activebackground=COLORS["panel_header_bg"],
                           activeforeground=COLORS["panel_header_fg"])
        cb.pack(side="right", padx=4)
        self.status_label = tk.Label(header, text="\u25cf STOPPED", fg=COLORS["status_stopped"],
                                     bg=COLORS["panel_header_bg"], font=("Consolas", 8))
        self.status_label.pack(side="right", padx=8)
        text_frame = tk.Frame(self, bg=COLORS["text_bg"])
        text_frame.pack(fill="both", expand=True)
        self.text = tk.Text(text_frame, bg=COLORS["text_bg"], fg=COLORS["text_fg"],
                           insertbackground=COLORS["text_cursor"], font=("Consolas", 10),
                           wrap=wrap_mode, state="disabled", relief="flat", borderwidth=0,
                           padx=10, pady=6, selectbackground="#334", maxundo=0)
        self.text.pack(side="left", fill="both", expand=True)
        scrollbar = tk.Scrollbar(text_frame, orient="vertical", command=self.text.yview,
                                bg="#1a1a28", troughcolor=COLORS["text_bg"], borderwidth=0)
        self.text.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        if show_hscroll:
            hscroll = tk.Scrollbar(self, orient="horizontal", command=self.text.xview,
                                   bg="#1a1a28", troughcolor=COLORS["text_bg"], borderwidth=0)
            self.text.configure(xscrollcommand=hscroll.set)
            hscroll.pack(side="bottom", fill="x")
        for tag, color in TAG_COLORS.items():
            self.text.tag_config(tag, foreground=color)
        self.max_lines = 5000

    def append(self, line, tag=None):
        self.text.configure(state="normal")
        self.text.insert("end", "[{}] ".format(time.strftime("%H:%M:%S")), "TIME")
        self.text.insert("end", line + "\n", tag if tag else "")
        lines = int(self.text.index("end-1c").split(".")[0])
        if lines > self.max_lines:
            self.text.delete("1.0", "{}.0".format(lines - self.max_lines))
        self.text.configure(state="disabled")
        self.text.see("end")

    def set_status(self, running):
        c = COLORS["status_running"] if running else COLORS["status_stopped"]
        self.status_label.configure(text="\u25cf RUNNING" if running else "\u25cf STOPPED", fg=c)

    def _toggle_wrap(self):
        mode = "word" if self.wrap_var.get() else "none"
        self.text.configure(wrap=mode)

    def append_many(self, items):
        """Batch insert: items = [(line, tag), ...]"""
        if not items:
            return
        self.text.configure(state="normal")
        ts = time.strftime("%H:%M:%S")
        for line, tag in items:
            self.text.insert("end", "[{}] ".format(ts), "TIME")
            self.text.insert("end", line + "\n", tag if tag else "")
        total_lines = int(self.text.index("end-1c").split(".")[0])
        if total_lines > self.max_lines:
            self.text.delete("1.0", "{}.0".format(total_lines - self.max_lines))
        self.text.configure(state="disabled")
        self.text.see("end")

    def set_max_lines(self, n):
        if n >= 100:
            self.max_lines = n


class LauncherApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("MuMuAINovel Launcher")
        self.root.geometry("1150x820")
        self.root.minsize(750, 550)
        self.root.configure(bg=COLORS["win_bg"])
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Toolbar.TFrame", background=COLORS["toolbar_bg"])
        style.configure("Panel.TFrame", background=COLORS["panel_bg"])
        style.configure("TButton", background=COLORS["btn_bg"], foreground=COLORS["btn_fg"],
                        borderwidth=0, focusthickness=0, padding=(10, 4), font=("Segoe UI", 9))
        style.map("TButton", background=[("active", COLORS["btn_active"])])
        try:
            ico = os.path.join(BACKEND, "static", "favicon.ico")
            if os.path.exists(ico):
                self.root.iconbitmap(ico)
        except Exception:
            pass
        toolbar = ttk.Frame(self.root, style="Toolbar.TFrame")
        toolbar.pack(fill="x", padx=6, pady=(6, 3))
        self.btn_start = ttk.Button(toolbar, text="Start All", command=self.start_all)
        self.btn_start.pack(side="left", padx=(2, 4))
        self.btn_stop = ttk.Button(toolbar, text="Stop All", command=self.stop_all, state="disabled")
        self.btn_stop.pack(side="left", padx=(0, 4))
        ttk.Separator(toolbar, orient="vertical").pack(side="left", fill="y", padx=8, pady=3)
        ttk.Button(toolbar, text="Backend", command=self.start_backend).pack(side="left", padx=2)
        ttk.Button(toolbar, text="Frontend", command=self.start_frontend).pack(side="left", padx=2)
        ttk.Button(toolbar, text="Kill Orphans", command=self._cleanup_orphans).pack(side="left", padx=2)
        ttk.Button(toolbar, text="Clear", command=self.clear_logs).pack(side="left", padx=2)
        tk.Label(toolbar, text="Max lines:", fg="#8a8a9e",
                bg=COLORS["toolbar_bg"], font=("Segoe UI", 8)).pack(side="right", padx=(12, 2))
        self.max_lines_var = tk.StringVar(value="5000")
        max_entry = tk.Entry(toolbar, textvariable=self.max_lines_var, width=5,
                            bg=COLORS["btn_bg"], fg=COLORS["btn_fg"], insertbackground=COLORS["text_cursor"],
                            font=("Consolas", 9), relief="flat", borderwidth=0, justify="center")
        max_entry.pack(side="right", padx=(0, 8))
        max_entry.bind("<Return>", lambda e: self._apply_max_lines())
        max_entry.bind("<FocusOut>", lambda e: self._apply_max_lines())
        self.llm_monitor_var = tk.BooleanVar(value=True)
        mon_cb = tk.Checkbutton(toolbar, text="Mon LLM", variable=self.llm_monitor_var,
                               command=self._toggle_llm_monitor, bg=COLORS["toolbar_bg"],
                               fg=COLORS["btn_fg"], selectcolor=COLORS["btn_bg"],
                               font=("Segoe UI", 8), activebackground=COLORS["toolbar_bg"],
                               activeforeground=COLORS["btn_fg"])
        mon_cb.pack(side="right", padx=(0, 8))
        tk.Label(toolbar, text=":8000 | Front:5173 | LLM:logs/", fg="#5a5a6e",
                bg=COLORS["toolbar_bg"], font=("Consolas", 8)).pack(side="right", padx=10)
        self.paned = tk.PanedWindow(self.root, orient="vertical", bg=COLORS["sash"],
                                    sashwidth=5, sashrelief="flat")
        self.paned.pack(fill="both", expand=True, padx=6, pady=(3, 6))
        self.backend_panel = LogPanel(self.paned, "Backend \u00b7 FastAPI", "#60a5fa")
        self.frontend_panel = LogPanel(self.paned, "Frontend \u00b7 Vite", "#a78bfa")
        self.llm_panel = LogPanel(self.paned, "LLM \u00b7 AI\u901a\u4fe1", "#38bdf8", wrap_mode="none", show_hscroll=True)
        self.paned.add(self.backend_panel, stretch="always", minsize=100)
        self.paned.add(self.frontend_panel, stretch="always", minsize=100)
        self.paned.add(self.llm_panel, stretch="always", minsize=100)
        self.backend_proc = None
        self.frontend_proc = None
        self.running = False
        self.llm_tail_running = False
        self.llm_offsets = {}
        self.log_queue = queue.Queue()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        atexit.register(self._force_cleanup)
        self.root.after(100, self._poll)
        self.root.after(500, self._auto_start)

    def _apply_max_lines(self):
        try:
            n = int(self.max_lines_var.get())
            for panel in [self.backend_panel, self.frontend_panel, self.llm_panel]:
                panel.set_max_lines(n)
        except ValueError:
            pass

    def _toggle_llm_monitor(self):
        if self.llm_monitor_var.get():
            if self.running:
                self._start_llm_tail()
        else:
            self._stop_llm_tail()

    def _auto_start(self):
        self._cleanup_orphans()
        self.root.after(1500, self.start_all)

    def _cleanup_orphans(self):
        self.backend_panel.append("Scanning for orphan processes...", "INFO")
        any_found = False
        for port, name in GUARD_PORTS:
            pids = _find_pids_on_port(port)
            if pids:
                any_found = True
                _kill_pids_force(self.backend_panel, port, pids)
        if not any_found:
            self.backend_panel.append("No orphans found", "SUCCESS")

    def _poll(self):
        batches = {}
        try:
            while True:
                panel, line, tag = self.log_queue.get_nowait()
                if panel not in batches:
                    batches[panel] = []
                batches[panel].append((line, tag))
        except queue.Empty:
            pass
        for panel, items in batches.items():
            panel.append_many(items)
        self.root.after(50, self._poll)

    def _reader(self, pipe, panel, prefix):
        ansi_re = re.compile(r"\x1b\[[0-9;]*m")
        try:
            for raw in iter(pipe.readline, ""):
                line = ansi_re.sub("", raw.rstrip())
                if not line:
                    continue
                self.log_queue.put((panel, line, self._tag(line, prefix)))
        except (ValueError, OSError):
            pass
        finally:
            pipe.close()

    def _tag(self, line, prefix):
        u = line.upper()
        if "ERROR" in u or "FAIL" in u or "TRACEBACK" in u:
            return "ERROR"
        if "WARNING" in u or "WARN" in u:
            return "WARN"
        if "SUCCESS" in u or "READY" in u or "[OK]" in u:
            return "SUCCESS"
        if "DEBUG" in u:
            return "DEBUG"
        if prefix == "frontend" and ("VITE" in u or "vite" in u):
            return "VITE"
        if prefix == "backend" and (
            "Uvicorn" in u or "Application" in u
            or "app.api." in line or "app.services." in line
            or re.search(r'[\w.]+:\d+\s+-\s+"(GET|POST|PUT|DELETE|PATCH|OPTIONS)', line)
        ):
            return "BACKEND"
        return "INFO"

    def _llm_tag(self, line, default_tag):
        u = line.upper()
        if "TOKEN:" in line or "\u7ed3\u675f\u539f\u56e0" in line:
            return "LLM_TOKEN"
        if u.startswith("SYSTEM:") or u.startswith("USER:"):
            return "LLM_SEND"
        if "\u5185\u5bb9:" in line:
            return "LLM_RECV"
        return default_tag

    def _check_and_free_port(self, port):
        pids = _find_pids_on_port(port)
        if not pids:
            return True
        return _kill_pids_force(self.backend_panel, port, pids)

    def start_backend(self):
        if self.backend_proc and self.backend_proc.poll() is None:
            self.backend_panel.append("Backend already running", "WARN")
            return
        self._check_and_free_port(8000)
        time.sleep(0.5)
        self.backend_panel.append("\u2500" * 40, "BACKEND")
        self.backend_panel.append("Starting Backend (FastAPI :8000)...", "BACKEND")
        try:
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            self.backend_proc = subprocess.Popen(
                BACKEND_CMD, cwd=BACKEND, env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                bufsize=1, creationflags=subprocess.CREATE_NO_WINDOW)
            self.backend_panel.set_status(True)
            threading.Thread(target=self._reader,
                           args=(self.backend_proc.stdout, self.backend_panel, "backend"),
                           daemon=True).start()
            self._update_btns()
        except Exception as e:
            self.backend_panel.append("Start failed: {}".format(e), "ERROR")

    def start_frontend(self):
        if self.frontend_proc and self.frontend_proc.poll() is None:
            self.frontend_panel.append("Frontend already running", "WARN")
            return
        self._check_and_free_port(5173)
        time.sleep(0.5)
        self.frontend_panel.append("\u2500" * 40, "VITE")
        self.frontend_panel.append("Starting Frontend (Vite :5173)...", "VITE")
        try:
            env = os.environ.copy()
            env["FORCE_COLOR"] = "0"
            self.frontend_proc = subprocess.Popen(
                FRONTEND_CMD, cwd=FRONTEND, env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                bufsize=1, creationflags=subprocess.CREATE_NO_WINDOW)
            self.frontend_panel.set_status(True)
            threading.Thread(target=self._reader,
                           args=(self.frontend_proc.stdout, self.frontend_panel, "frontend"),
                           daemon=True).start()
            self._update_btns()
        except Exception as e:
            self.frontend_panel.append("Start failed: {}".format(e), "ERROR")

    def start_all(self):
        self.start_backend()
        self.root.after(1500, self.start_frontend)
        self.root.after(4000, self._start_llm_tail)
        self.running = True
        self._update_btns()

    def _kill_proc_tree(self, proc):
        try:
            parent = psutil.Process(proc.pid)
            children = parent.children(recursive=True)
            for child in children:
                try:
                    child.kill()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            parent.kill()
            psutil.wait_procs(children + [parent], timeout=5)
        except psutil.NoSuchProcess:
            pass
        except Exception:
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                              capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
            except Exception:
                pass

    def stop_all(self):
        self._stop_llm_tail()
        for name, proc, panel in [
            ("Backend", self.backend_proc, self.backend_panel),
            ("Frontend", self.frontend_proc, self.frontend_panel)]:
            if proc and proc.poll() is None:
                panel.append("--- Stopping {} ---".format(name), "WARN")
                self._kill_proc_tree(proc)
                panel.append("{} stopped".format(name), "INFO")
                panel.set_status(False)
        self.backend_proc = None
        self.frontend_proc = None
        self.running = False
        self._update_btns()

    def clear_logs(self):
        for panel in [self.backend_panel, self.frontend_panel, self.llm_panel]:
            panel.text.configure(state="normal")
            panel.text.delete("1.0", "end")
            panel.text.configure(state="disabled")

    def _update_btns(self):
        any_running = (self.backend_proc and self.backend_proc.poll() is None) or \
                      (self.frontend_proc and self.frontend_proc.poll() is None)
        self.btn_stop.configure(state="normal" if any_running else "disabled")

    # --- LLM file-tail ---

    def _start_llm_tail(self):
        if self.llm_tail_running:
            return
        self.llm_panel.append("\u2500" * 40, "LLM_TOKEN")
        self.llm_panel.append("Watching: llm_send.log + llm_recv.log", "LLM_TOKEN")
        self.llm_panel.set_status(True)
        self.llm_tail_running = True
        self.llm_offsets = {LLM_SEND_LOG: os.path.getsize(LLM_SEND_LOG) if os.path.exists(LLM_SEND_LOG) else 0,
                            LLM_RECV_LOG: os.path.getsize(LLM_RECV_LOG) if os.path.exists(LLM_RECV_LOG) else 0}
        threading.Thread(target=self._llm_tailer, daemon=True).start()

    def _stop_llm_tail(self):
        if self.llm_tail_running:
            self.llm_panel.append("--- LLM watch paused ---", "LLM_TOKEN")
        self.llm_tail_running = False
        self.llm_panel.set_status(False)

    def _llm_tailer(self):
        log_configs = [(LLM_SEND_LOG, "LLM_SEND"), (LLM_RECV_LOG, "LLM_RECV")]
        file_seen = {LLM_SEND_LOG: False, LLM_RECV_LOG: False}
        while self.llm_tail_running:
            for path, default_tag in log_configs:
                try:
                    if not os.path.exists(path):
                        if file_seen[path]:
                            self.log_queue.put((self.llm_panel, "(waiting for log file...)", "LLM_TOKEN"))
                            file_seen[path] = False
                        self.llm_offsets[path] = 0
                        continue
                    if not file_seen[path]:
                        self.log_queue.put((self.llm_panel, "Tracking {}...".format(os.path.basename(path)), "LLM_TOKEN"))
                        file_seen[path] = True
                    sz = os.path.getsize(path)
                    off = self.llm_offsets.get(path, 0)
                    if sz < off:
                        off = 0
                    if sz <= off:
                        continue
                    with open(path, "r", encoding="utf-8", errors="replace") as f:
                        f.seek(off)
                        for line in f:
                            stripped = line.rstrip()
                            if not stripped:
                                continue
                            self.log_queue.put((self.llm_panel, stripped,
                                              self._llm_tag(stripped, default_tag)))
                        self.llm_offsets[path] = f.tell()
                except Exception:
                    pass
            time.sleep(0.5)

    def _on_close(self):
        if self.running:
            if not messagebox.askyesno("Exit", "Services are running.\nClose and stop all services?"):
                return
        self.stop_all()
        self.running = False
        self.root.destroy()

    def _force_cleanup(self):
        self._stop_llm_tail()
        for proc in [self.backend_proc, self.frontend_proc]:
            if proc and proc.poll() is None:
                self._kill_proc_tree(proc)

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    LauncherApp().run()