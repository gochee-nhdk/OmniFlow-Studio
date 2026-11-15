using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace FmAutoOps
{
    static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        private const int SW_RESTORE = 9;
        private const int SW_SHOW = 5;

        [STAThread]
        static void Main()
        {
            try
            {
                // 1. Check for existing active FM AUTO OPS window
                Process[] procs = Process.GetProcessesByName("electron");
                bool foundWindow = false;

                foreach (Process p in procs)
                {
                    try
                    {
                        if (p.MainWindowHandle != IntPtr.Zero)
                        {
                            if (IsIconic(p.MainWindowHandle))
                            {
                                ShowWindow(p.MainWindowHandle, SW_RESTORE);
                            }
                            else
                            {
                                ShowWindow(p.MainWindowHandle, SW_SHOW);
                            }
                            SetForegroundWindow(p.MainWindowHandle);
                            foundWindow = true;
                            return;
                        }
                    }
                    catch { }
                }

                // If procs exist without MainWindowHandle (zombies), kill them cleanly
                if (!foundWindow && procs.Length > 0)
                {
                    foreach (Process p in procs)
                    {
                        try { p.Kill(); } catch { }
                    }
                    System.Threading.Thread.Sleep(300);
                }

                // 2. Launch Electron cleanly
                string baseDir = @"d:\tool auto\FM-AUTO-OPS\apps\local-agent";
                string electronExe = Path.Combine(baseDir, @"node_modules\electron\dist\electron.exe");
                string mainJs = Path.Combine(baseDir, @"dist\main\index.js");

                if (!File.Exists(electronExe))
                {
                    MessageBox.Show(
                        "Không tìm thấy file electron tại:\n" + electronExe,
                        "FM AUTO OPS",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = electronExe;
                psi.Arguments = "\"" + mainJs + "\"";
                psi.WorkingDirectory = baseDir;
                psi.UseShellExecute = true;
                psi.WindowStyle = ProcessWindowStyle.Normal;

                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Lỗi khởi động FM AUTO OPS:\n" + ex.Message,
                    "FM AUTO OPS",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
