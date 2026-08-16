using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;

namespace DiskCleanUi;

static class Program
{
    // App runs elevated (app.manifest requireAdministrator). The engine child inherits admin.

    private static string EnginePath = string.Empty;
    private static string WebDir = string.Empty;
    private static int Port;
    private static string Token = string.Empty;
    private static Process EngineProc;
    private static HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };

    [STAThread]
    static void Main(string[] args)
    {
        Log("main start");
        // Parse optional args: --engine <path> --web <dir> --port <n>
        var argEngine = GetArg(args, "--engine");
        var argWeb = GetArg(args, "--web");
        EnginePath = string.IsNullOrEmpty(argEngine) ? Path.Combine(AppContext.BaseDirectory, "engine.exe") : argEngine;
        WebDir = string.IsNullOrEmpty(argWeb) ? Path.Combine(AppContext.BaseDirectory, "web") : argWeb;
        Port = FindFreePort();
        Log("engine=" + EnginePath + " web=" + WebDir + " port=" + Port);

        if (!File.Exists(EnginePath))
        {
            Log("FATAL engine missing");
            Fatal("Engine not found: " + EnginePath + "\n\nExpected disk-clean engine (engine.exe) next to the UI shell.");
            return;
        }
        if (!Directory.Exists(WebDir))
        {
            Log("FATAL web missing");
            Fatal("Web UI not found: " + WebDir + "\n\nExpected a 'web' folder next to the UI shell.");
            return;
        }

        Token = Guid.NewGuid().ToString("N");
        Log("starting engine");
        StartEngine();
        Log("waiting engine");
        if (!WaitForEngine())
        {
            var exitInfo = EngineProc == null ? "no proc" : ("exited=" + EngineProc.HasExited + (EngineProc.HasExited ? " code=" + EngineProc.ExitCode : ""));
            Log("FATAL engine timeout (" + exitInfo + ")");
            KillEngine();
            Fatal("Engine failed to start (timeout waiting for /api/health).");
            return;
        }
        Log("engine ready");

        ApplicationConfiguration.Initialize();
        using var form = new MainForm(Port, Token);
        Application.Run(form);
        Log("app exit");
        KillEngine();
        Log("done");
    }

    static void Log(string msg)
    {
        try
        {
            System.IO.File.AppendAllText(
                System.IO.Path.Combine(System.IO.Path.GetTempPath(), "disk-clean-ui.log"),
                DateTime.Now.ToString("HH:mm:ss.fff") + " " + msg + "\r\n");
        }
        catch { }
    }

    static string GetArg(string[] args, string name)
    {
        for (int i = 0; i < args.Length - 1; i++)
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        return string.Empty;
    }

    static int FindFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    static void StartEngine()
    {
        var quote = (string s) => "\"" + s.Replace("\"", "\\\"") + "\"";
        var argsLine = "serve --port " + Port + " --token " + Token + " --web " + quote(WebDir);
        var psi = new ProcessStartInfo
        {
            FileName = EnginePath,
            WorkingDirectory = Path.GetDirectoryName(EnginePath),
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8,
            Arguments = argsLine,
        };
        EngineProc = Process.Start(psi);
        Log("engine spawned pid=" + EngineProc.Id + " cmdline=[" + psi.FileName + " " + psi.Arguments + "]");
        EngineProc.OutputDataReceived += (_, e) => { if (!string.IsNullOrEmpty(e.Data)) Log("ENGINE OUT: " + e.Data); };
        EngineProc.ErrorDataReceived += (_, e) => { if (!string.IsNullOrEmpty(e.Data)) Log("ENGINE ERR: " + e.Data); };
        EngineProc.BeginOutputReadLine();
        EngineProc.BeginErrorReadLine();
    }

    static bool WaitForEngine()
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            if (EngineProc != null && EngineProc.HasExited)
                return false;
            try
            {
                var resp = Http.GetAsync($"http://127.0.0.1:{Port}/api/health").GetAwaiter().GetResult();
                if (resp.IsSuccessStatusCode)
                    return true;
            }
            catch
            {
                // not up yet
            }
            Thread.Sleep(300);
        }
        return false;
    }

    static void KillEngine()
    {
        if (EngineProc != null && !EngineProc.HasExited)
        {
            try { EngineProc.Kill(entireProcessTree: true); } catch { }
            EngineProc.Dispose();
            EngineProc = null;
        }
    }

    static void Fatal(string message)
    {
        MessageBox.Show(message, "disk-clean", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}