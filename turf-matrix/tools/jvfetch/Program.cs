using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

namespace TurfMatrix.JvFetch
{
    internal static class Program
    {
        private const string DefaultProgId = "JVDTLab.JVLink";

        private static int Main(string[] args)
        {
            try
            {
                var options = ParseArgs(args);
                var repoRoot = ResolveRepoRoot();
                var logPath = Path.Combine(repoRoot, "data", "target", "jvfetch-log.txt");
                Directory.CreateDirectory(Path.GetDirectoryName(logPath));

                if (options.Help || args.Length == 0)
                {
                    WriteUsage();
                    return 2;
                }

                if (options.Week || options.OddsOnly)
                {
                    Log(logPath, "WARN", "--week / --odds-only are intentionally not implemented in Step1.");
                    Console.Error.WriteLine("--week / --odds-only are Step6+ scope. Step1 implements --check only.");
                    return 2;
                }

                if (!options.Check)
                {
                    WriteUsage();
                    return 2;
                }

                return RunCheck(options, logPath);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("jvfetch failed: " + SafeMessage(ex));
                return 2;
            }
        }

        private static int RunCheck(Options options, string logPath)
        {
            var progId = string.IsNullOrWhiteSpace(options.ProgId) ? DefaultProgId : options.ProgId;
            var sid = FirstNonEmpty(options.Sid, Environment.GetEnvironmentVariable("JVLINK_SID"), "UNKNOWN");

            Log(logPath, "INFO", "jvfetch --check started.");
            Log(logPath, "INFO", "processArchitecture=" + (Environment.Is64BitProcess ? "x64" : "x86"));
            Log(logPath, "INFO", "progId=" + progId);

            if (Environment.Is64BitProcess)
            {
                Log(logPath, "ERROR", "JV-Link requires x86 process. This executable is running as x64.");
                Console.Error.WriteLine("JV-Link requires x86 process. Build/run jvfetch as x86.");
                return 2;
            }

            object jvLink = null;
            try
            {
                var type = Type.GetTypeFromProgID(progId);
                if (type == null)
                {
                    Log(logPath, "ERROR", "COM ProgID was not found: " + progId);
                    Console.Error.WriteLine("COM ProgID was not found: " + progId);
                    return 2;
                }

                jvLink = Activator.CreateInstance(type);
                var version = Convert.ToString(ReadProperty(jvLink, "m_JVLinkVersion") ?? "");
                Log(logPath, "INFO", "version=" + (string.IsNullOrEmpty(version) ? "(unknown)" : version));

                var initResult = InvokeInt(jvLink, "JVInit", sid);
                Log(logPath, initResult == 0 ? "INFO" : "ERROR", "JVInit result=" + initResult);

                Console.WriteLine("{");
                Console.WriteLine("  \"status\": \"" + (initResult == 0 ? "ready" : "init-error") + "\",");
                Console.WriteLine("  \"architecture\": \"x86\",");
                Console.WriteLine("  \"progId\": \"" + EscapeJson(progId) + "\",");
                Console.WriteLine("  \"version\": \"" + EscapeJson(version) + "\",");
                Console.WriteLine("  \"initResult\": " + initResult);
                Console.WriteLine("}");

                return initResult == 0 ? 0 : 2;
            }
            finally
            {
                if (jvLink != null)
                {
                    TryInvoke(jvLink, "JVClose");
                    Marshal.FinalReleaseComObject(jvLink);
                }
            }
        }

        private static string ResolveRepoRoot()
        {
            var dir = AppDomain.CurrentDomain.BaseDirectory;
            while (!string.IsNullOrEmpty(dir))
            {
                if (Directory.Exists(Path.Combine(dir, ".git")) || File.Exists(Path.Combine(dir, "package.json")))
                {
                    return dir;
                }
                var parent = Directory.GetParent(dir);
                dir = parent == null ? null : parent.FullName;
            }
            return Directory.GetCurrentDirectory();
        }

        private static string SafeMessage(Exception ex)
        {
            if (ex == null) return "(unknown error)";
            try
            {
                return string.IsNullOrEmpty(ex.Message) ? ex.GetType().FullName : ex.Message;
            }
            catch
            {
                return "(exception message unavailable)";
            }
        }

        private static object ReadProperty(object target, string name)
        {
            try
            {
                return target.GetType().InvokeMember(name, BindingFlags.GetProperty, null, target, null);
            }
            catch
            {
                return null;
            }
        }

        private static int InvokeInt(object target, string name, params object[] args)
        {
            var value = target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, args);
            return Convert.ToInt32(value);
        }

        private static void TryInvoke(object target, string name)
        {
            try
            {
                target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, null);
            }
            catch
            {
                // JVClose can fail before JVOpen; Step1 only needs COM/JVInit diagnostics.
            }
        }

        private static Options ParseArgs(string[] args)
        {
            var options = new Options();
            for (var i = 0; i < args.Length; i++)
            {
                var arg = args[i];
                if (arg == "--check") options.Check = true;
                else if (arg == "--week") options.Week = true;
                else if (arg == "--odds-only") options.OddsOnly = true;
                else if (arg == "--help" || arg == "-h") options.Help = true;
                else if (arg == "--sid" && i + 1 < args.Length) options.Sid = args[++i];
                else if (arg == "--prog-id" && i + 1 < args.Length) options.ProgId = args[++i];
                else if (arg == "--races" && i + 1 < args.Length) options.Races = args[++i];
                else
                {
                    options.Help = true;
                    options.UnknownArgs.Add(arg);
                }
            }
            return options;
        }

        private static void WriteUsage()
        {
            Console.WriteLine("TURF MATRIX jvfetch Step1");
            Console.WriteLine("Usage:");
            Console.WriteLine("  jvfetch.exe --check [--sid <JV-Link SID>] [--prog-id JVDTLab.JVLink]");
            Console.WriteLine("  jvfetch.exe --week       (Step6+ scope; not implemented in Step1)");
            Console.WriteLine("  jvfetch.exe --odds-only  (Step6 scope; not implemented in Step1)");
        }

        private static void Log(string path, string level, string message)
        {
            try
            {
                var line = DateTime.Now.ToString("s") + " [" + level + "] " + message + Environment.NewLine;
                File.AppendAllText(path, line, new UTF8Encoding(true));
            }
            catch
            {
                // Diagnostics must not block JV-Link checks; console output remains authoritative.
            }
        }

        private static string FirstNonEmpty(params string[] values)
        {
            foreach (var value in values)
            {
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
            return "";
        }

        private static string EscapeJson(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private sealed class Options
        {
            private readonly List<string> _unknownArgs = new List<string>();

            public bool Check { get; set; }
            public bool Week { get; set; }
            public bool OddsOnly { get; set; }
            public bool Help { get; set; }
            public string Sid { get; set; }
            public string ProgId { get; set; }
            public string Races { get; set; }
            public List<string> UnknownArgs { get { return _unknownArgs; } }
        }
    }
}
