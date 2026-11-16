using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace OmniFlowStudio
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
                // 1. Locate root application directory and local-agent
                string appDir = AppDomain.CurrentDomain.BaseDirectory;
                string localAgentDir = FindLocalAgentDir(appDir);

                if (string.IsNullOrEmpty(localAgentDir))
                {
                    MessageBox.Show(
                        "Không tìm thấy thư mục ứng dụng 'apps\\local-agent'.\n" +
                        "Thư mục khởi chạy hiện tại: " + appDir,
                        "OmniFlow Studio",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                string electronExe = FindElectronExe(localAgentDir, appDir);
                string mainJs = Path.Combine(localAgentDir, @"dist\main\index.js");

                // Check for existing active OmniFlow Studio / Electron window
                // Only inspect and manage electron processes belonging to OmniFlow Studio's path!
                Process[] procs = Process.GetProcessesByName("electron");
                bool foundWindow = false;

                foreach (Process p in procs)
                {
                    try
                    {
                        if (IsProcessUnderAppDir(p, appDir, localAgentDir, electronExe))
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
                    }
                    catch { }
                }

                // If procs belonging to OmniFlow Studio exist without MainWindowHandle (zombies), kill them cleanly
                if (!foundWindow && procs.Length > 0)
                {
                    foreach (Process p in procs)
                    {
                        try
                        {
                            if (IsProcessUnderAppDir(p, appDir, localAgentDir, electronExe))
                            {
                                p.Kill();
                            }
                        }
                        catch { }
                    }
                    System.Threading.Thread.Sleep(300);
                }

                if (string.IsNullOrEmpty(electronExe) || !File.Exists(electronExe))
                {
                    MessageBox.Show(
                        "Không tìm thấy file electron tại ứng dụng:\n" +
                        "Thư mục khởi chạy: " + appDir + "\n" +
                        "Thư mục local-agent: " + localAgentDir,
                        "OmniFlow Studio",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                if (!File.Exists(mainJs))
                {
                    MessageBox.Show(
                        "Không tìm thấy file khởi chạy main index.js tại:\n" + mainJs,
                        "OmniFlow Studio",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Set portable environment variables for child processes
                string portableDir = Path.GetFullPath(appDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                Environment.SetEnvironmentVariable("OMNIFLOW_PORTABLE", "true");
                Environment.SetEnvironmentVariable("PORTABLE_EXECUTABLE_DIR", portableDir);

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = electronExe;
                psi.Arguments = "\"" + mainJs + "\"";
                psi.WorkingDirectory = localAgentDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = false;
                psi.WindowStyle = ProcessWindowStyle.Normal;
                psi.EnvironmentVariables["OMNIFLOW_PORTABLE"] = "true";
                psi.EnvironmentVariables["PORTABLE_EXECUTABLE_DIR"] = portableDir;

                // Ensure Desktop shortcut exists for 1-click convenience
                EnsureDesktopShortcut(appDir, electronExe);

                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Lỗi khởi động OmniFlow Studio:\n" + ex.Message,
                    "OmniFlow Studio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private static string FindLocalAgentDir(string baseDir)
        {
            string[] candidatePaths = new string[]
            {
                Path.Combine(baseDir, "apps", "local-agent"),
                Path.Combine(baseDir, "OmniFlow-Studio", "apps", "local-agent"),
                Path.Combine(baseDir, "..", "apps", "local-agent"),
                Path.Combine(baseDir, "..", "OmniFlow-Studio", "apps", "local-agent"),
                Path.Combine(baseDir, "FM-AUTO-OPS", "apps", "local-agent"),
                Path.Combine(baseDir, "..", "FM-AUTO-OPS", "apps", "local-agent"),
                @"d:\tool auto\OmniFlow-Studio\apps\local-agent",
                @"d:\tool auto\FM-AUTO-OPS\apps\local-agent"
            };

            foreach (string path in candidatePaths)
            {
                try
                {
                    string fullPath = Path.GetFullPath(path);
                    if (Directory.Exists(fullPath))
                    {
                        return fullPath;
                    }
                }
                catch { }
            }

            return null;
        }

        private static string FindElectronExe(string localAgentDir, string baseDir)
        {
            string[] candidatePaths = new string[]
            {
                Path.Combine(localAgentDir, @"node_modules\electron\dist\electron.exe"),
                Path.Combine(localAgentDir, @"..\..\node_modules\electron\dist\electron.exe"),
                Path.Combine(localAgentDir, @"..\..\node_modules\.pnpm\electron@45.3.1_supports-color@7.2.0\node_modules\electron\dist\electron.exe"),
                Path.Combine(baseDir, @"node_modules\electron\dist\electron.exe"),
                Path.Combine(baseDir, @"OmniFlow-Studio\node_modules\electron\dist\electron.exe"),
                Path.Combine(baseDir, @"OmniFlow-Studio\apps\local-agent\node_modules\electron\dist\electron.exe"),
                @"d:\tool auto\OmniFlow-Studio\apps\local-agent\node_modules\electron\dist\electron.exe",
                @"d:\tool auto\OmniFlow-Studio\node_modules\.pnpm\electron@45.3.1_supports-color@7.2.0\node_modules\electron\dist\electron.exe",
                @"d:\tool auto\FM-AUTO-OPS\apps\local-agent\node_modules\electron\dist\electron.exe"
            };

            foreach (string path in candidatePaths)
            {
                try
                {
                    string fullPath = Path.GetFullPath(path);
                    if (File.Exists(fullPath))
                    {
                        return fullPath;
                    }
                }
                catch { }
            }

            // Fallback: search for electron.exe in candidate root node_modules
            string[] searchRoots = new string[]
            {
                Path.Combine(localAgentDir, "node_modules"),
                Path.Combine(localAgentDir, @"..\..\node_modules"),
                Path.Combine(baseDir, "node_modules")
            };

            foreach (string sRoot in searchRoots)
            {
                try
                {
                    string fullRoot = Path.GetFullPath(sRoot);
                    if (Directory.Exists(fullRoot))
                    {
                        string[] matches = Directory.GetFiles(fullRoot, "electron.exe", SearchOption.AllDirectories);
                        if (matches != null && matches.Length > 0)
                        {
                            return matches[0];
                        }
                    }
                }
                catch { }
            }

            return null;
        }

        private static bool IsProcessUnderAppDir(Process p, string appDir, string localAgentDir, string electronExe)
        {
            try
            {
                if (p.MainModule == null)
                {
                    return false;
                }

                string procPath = p.MainModule.FileName;
                if (string.IsNullOrEmpty(procPath))
                {
                    return false;
                }

                string normalizedProcPath = Path.GetFullPath(procPath);

                if (!string.IsNullOrEmpty(electronExe))
                {
                    string normalizedElectronExe = Path.GetFullPath(electronExe);
                    if (string.Equals(normalizedProcPath, normalizedElectronExe, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }

                if (!string.IsNullOrEmpty(appDir))
                {
                    string normalizedAppDir = Path.GetFullPath(appDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                    if (normalizedProcPath.StartsWith(normalizedAppDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }

                if (!string.IsNullOrEmpty(localAgentDir))
                {
                    string normalizedLocalAgentDir = Path.GetFullPath(localAgentDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                    if (normalizedProcPath.StartsWith(normalizedLocalAgentDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
            }
            catch
            {
                // Access denied or process exited: do not touch unknown processes
                return false;
            }

            return false;
        }

        private static void EnsureDesktopShortcut(string appDir, string electronExe)
        {
            try
            {
                string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
                if (string.IsNullOrEmpty(desktopPath) || !Directory.Exists(desktopPath))
                {
                    return;
                }

                string shortcutPath = Path.Combine(desktopPath, "OmniFlow Studio.lnk");
                string currentExe = null;
                try
                {
                    if (Process.GetCurrentProcess().MainModule != null)
                    {
                        currentExe = Process.GetCurrentProcess().MainModule.FileName;
                    }
                }
                catch { }

                if (string.IsNullOrEmpty(currentExe) || !File.Exists(currentExe))
                {
                    currentExe = Path.Combine(appDir, "OmniFlow Studio.exe");
                }

                string workDir = Path.GetFullPath(appDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string iconPath = Path.Combine(appDir, @"assets\app-icon.ico");
                if (!File.Exists(iconPath))
                {
                    iconPath = Path.Combine(appDir, @"OmniFlow-Studio\assets\app-icon.ico");
                }
                if (!File.Exists(iconPath))
                {
                    iconPath = currentExe;
                }

                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;

                object shell = Activator.CreateInstance(shellType);
                object shortcut = shellType.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
                if (shortcut == null) return;

                Type shortcutType = shortcut.GetType();
                string existingTarget = shortcutType.InvokeMember("TargetPath", System.Reflection.BindingFlags.GetProperty, null, shortcut, null) as string;

                if (File.Exists(shortcutPath) && !string.IsNullOrEmpty(existingTarget))
                {
                    if (string.Equals(Path.GetFullPath(existingTarget), Path.GetFullPath(currentExe), StringComparison.OrdinalIgnoreCase))
                    {
                        return; // Shortcut already points to this executable
                    }
                }

                shortcutType.InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { currentExe });
                shortcutType.InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { workDir });
                shortcutType.InvokeMember("Description", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { "OmniFlow Studio" });
                if (File.Exists(iconPath))
                {
                    shortcutType.InvokeMember("IconLocation", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { iconPath + ",0" });
                }
                shortcutType.InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, shortcut, null);
            }
            catch
            {
                // Fail-safe: shortcut creation must never block app launch
            }
        }
    }
}
