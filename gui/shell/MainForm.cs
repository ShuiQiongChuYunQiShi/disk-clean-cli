using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DiskCleanUi;

public class MainForm : Form
{
    private readonly int _port;
    private readonly string _token;
    private WebView2 _web;

    public MainForm(int port, string token)
    {
        _port = port;
        _token = token;
        Text = "disk-clean — 磁盘清理与分析";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1280, 820);
        MinimumSize = new Size(960, 640);

        _web = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(18, 20, 26),
        };
        Controls.Add(_web);

        Load += async (_, _) => await InitializeWebViewAsync();
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            Log("webview init start");
            var env = await CoreWebView2Environment.CreateAsync(
                userDataFolder: Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "disk-clean", "webview2"));
            Log("webview env ok");
            await _web.EnsureCoreWebView2Async(env);
            Log("core webview2 ok");

            // Inject the session token so the frontend can authenticate API calls.
            // Backend ignores tokens for /api/health; everything else requires Bearer.
            var script = $"window.__DSK_TOKEN__ = '{_token}';" +
                         $"window.__DSK_URL__ = 'http://127.0.0.1:{_port}';";
            await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(script);
            _web.CoreWebView2.Navigate($"http://127.0.0.1:{_port}/");
            Log("navigate ok");
        }
        catch (Exception ex)
        {
            Log("WEBVIEW FAIL: " + ex);
            MessageBox.Show(
                "无法初始化 WebView2。\n\n" + ex.Message +
                "\n\n请确认已安装 Microsoft Edge WebView2 Runtime（安装器可代为安装）。",
                "disk-clean", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
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
}