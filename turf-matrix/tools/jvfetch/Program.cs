using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace TurfMatrix.JvFetch
{
    internal static class Program
    {
        private const string DefaultProgId = "JVDTLab.JVLink";
        private const string OddsDataSpec = "0B31";

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

                if (options.Week)
                {
                    return RunWeek(options, repoRoot, logPath);
                }

                if (options.OddsOnly)
                {
                    return RunOddsOnly(options, repoRoot, logPath);
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

        private static int RunOddsOnly(Options options, string repoRoot, string logPath)
        {
            var progId = string.IsNullOrWhiteSpace(options.ProgId) ? DefaultProgId : options.ProgId;
            var sid = FirstNonEmpty(options.Sid, Environment.GetEnvironmentVariable("JVLINK_SID"), "UNKNOWN");
            var configPath = Path.Combine(repoRoot, "tools", "race-batch-config.json");
            var races = LoadRaceTargets(configPath);
            var odds = new List<OddsRow>();
            var warnings = new List<string>();

            Log(logPath, "INFO", "jvfetch --odds-only started.");

            if (Environment.Is64BitProcess)
            {
                Console.Error.WriteLine("JV-Link requires x86 process. Build/run jvfetch as x86.");
                return 2;
            }

            object jvLink = null;
            try
            {
                var type = Type.GetTypeFromProgID(progId);
                if (type == null)
                {
                    Console.Error.WriteLine("COM ProgID was not found: " + progId);
                    return 2;
                }

                jvLink = Activator.CreateInstance(type);
                var initResult = InvokeInt(jvLink, "JVInit", sid);
                if (initResult != 0)
                {
                    Console.Error.WriteLine("JVInit failed: " + initResult);
                    return 2;
                }

                foreach (var race in races)
                {
                    var openResult = InvokeInt(jvLink, "JVRTOpen", OddsDataSpec, race.JvKey);
                    if (openResult < 0)
                    {
                        warnings.Add(race.Label + " JVRTOpen=" + openResult);
                        continue;
                    }

                    ReadOddsRecords(jvLink, race, odds, warnings);
                    TryInvoke(jvLink, "JVClose");
                }
            }
            finally
            {
                if (jvLink != null)
                {
                    TryInvoke(jvLink, "JVClose");
                    Marshal.FinalReleaseComObject(jvLink);
                }
            }

            if (odds.Count == 0)
            {
                Console.Error.WriteLine("No O1 odds records were acquired. Existing data was not changed.");
                foreach (var warning in warnings) Console.Error.WriteLine("WARN " + warning);
                return 2;
            }

            var missingHorseNames = ApplyHorseNames(repoRoot, odds);
            if (missingHorseNames > 0)
            {
                Console.Error.WriteLine("Horse names could not be resolved for " + missingHorseNames + " odds rows. Existing data was not changed.");
                return 2;
            }

            var outputPath = Path.Combine(repoRoot, "data", "target", "odds.csv");
            var writtenPath = WriteOddsCsvSafely(outputPath, odds);
            if (!string.Equals(writtenPath, outputPath, StringComparison.OrdinalIgnoreCase))
            {
                warnings.Add("odds.csv was not replaced; generated file: " + writtenPath);
            }

            Console.WriteLine("{");
            Console.WriteLine("  \"status\": \"" + (warnings.Count == 0 ? "ready" : "partial") + "\",");
            Console.WriteLine("  \"dataspec\": \"" + OddsDataSpec + "\",");
            Console.WriteLine("  \"raceCount\": " + races.Count + ",");
            Console.WriteLine("  \"oddsRows\": " + odds.Count + ",");
            Console.WriteLine("  \"output\": \"" + EscapeJson(writtenPath) + "\"");
            Console.WriteLine("}");

            foreach (var warning in warnings) Console.Error.WriteLine("WARN " + warning);
            return warnings.Count == 0 ? 0 : 1;
        }

        private static void ReadOddsRecords(object jvLink, RaceTarget race, List<OddsRow> rows, List<string> warnings)
        {
            var encoding = Encoding.GetEncoding(932);
            var sawO1 = false;

            for (var iteration = 0; iteration < 10000; iteration++)
            {
                var buffer = new string(' ', 4096);
                var fileName = "";
                var readArgs = new object[] { buffer, 4096, fileName };
                var readResult = InvokeJvRead(jvLink, readArgs);
                buffer = Convert.ToString(readArgs[0] ?? "");
                fileName = Convert.ToString(readArgs[2] ?? "");

                if (readResult > 0)
                {
                    var bytes = encoding.GetBytes(buffer);
                    var recordId = GetJvField(bytes, 1, 2);
                    if (recordId != "O1") continue;

                    sawO1 = true;
                    var dataKubun = GetJvField(bytes, 3, 1);
                    var dataCreatedAt = GetJvField(bytes, 4, 8);
                    var announce = GetJvField(bytes, 28, 8);
                    var runners = ParseNullableInt(GetJvField(bytes, 38, 2));
                    var winFlag = GetJvField(bytes, 40, 1);
                    var status = ResolveOddsStatus(dataKubun, winFlag);
                    var updatedAt = BuildOddsUpdatedAt(race.RaceDate, announce, dataCreatedAt);

                    for (var i = 0; i < 28; i++)
                    {
                        var start = 44 + i * 8;
                        var horseNoRaw = GetJvField(bytes, start, 2);
                        if (string.IsNullOrWhiteSpace(horseNoRaw)) continue;

                        var oddsRaw = GetJvField(bytes, start + 2, 4);
                        var popularityRaw = GetJvField(bytes, start + 6, 2);
                        var winOdds = ParseOdds(oddsRaw);
                        var popularity = ParseNullableInt(popularityRaw);

                        if (winOdds == null && popularity == null) continue;

                        rows.Add(new OddsRow
                        {
                            Race = race,
                            HorseNumber = ParseNullableInt(horseNoRaw),
                            WinOdds = winOdds,
                            Popularity = popularity,
                            UpdatedAt = updatedAt,
                            Source = "JV-Link " + OddsDataSpec,
                            Status = status,
                            DataKubun = dataKubun,
                            Runners = runners
                        });
                    }
                }
                else if (readResult == -3)
                {
                    System.Threading.Thread.Sleep(200);
                }
                else if (readResult == -1)
                {
                    continue;
                }
                else if (readResult == 0)
                {
                    break;
                }
                else
                {
                    warnings.Add(race.Label + " JVRead=" + readResult);
                    break;
                }
            }

            if (!sawO1)
            {
                warnings.Add(race.Label + " O1 record not found");
            }
        }

        private static List<RaceTarget> LoadRaceTargets(string configPath)
        {
            if (!File.Exists(configPath)) throw new FileNotFoundException("race-batch-config was not found.", configPath);

            var json = File.ReadAllText(configPath, Encoding.UTF8);
            var raceDate = MatchRequired(json, "\"raceDate\"\\s*:\\s*\"([0-9]{4}-[0-9]{2}-[0-9]{2})\"");
            var matches = Regex.Matches(json, "\"([0-9]{4}-[0-9]{2}-[0-9]{2})-([a-z]+)-([0-9]{1,2})R\"");
            var races = new List<RaceTarget>();

            foreach (Match match in matches)
            {
                if (match.Groups[1].Value != raceDate) continue;
                var slug = match.Groups[2].Value;
                var raceNo = int.Parse(match.Groups[3].Value);
                var course = CourseInfo.FromSlug(slug);
                races.Add(new RaceTarget
                {
                    RaceDate = raceDate,
                    CourseSlug = slug,
                    CourseCode = course.Code,
                    CourseName = course.Name,
                    RaceNo = raceNo,
                    JvKey = raceDate.Replace("-", "") + course.Code + raceNo.ToString("00")
                });
            }

            if (races.Count == 0) throw new InvalidOperationException("No race bundles were found in race-batch-config.");
            return races;
        }

        private static string MatchRequired(string value, string pattern)
        {
            var match = Regex.Match(value, pattern);
            if (!match.Success) throw new InvalidOperationException("Required config value was not found: " + pattern);
            return match.Groups[1].Value;
        }

        private static string GetJvField(byte[] bytes, int start, int length)
        {
            if (bytes.Length < start) return "";
            var available = Math.Min(length, bytes.Length - start + 1);
            if (available <= 0) return "";
            return Encoding.GetEncoding(932).GetString(bytes, start - 1, available).Trim();
        }

        private static int? ParseNullableInt(string raw)
        {
            int value;
            return int.TryParse((raw ?? "").Trim(), out value) && value > 0 ? (int?)value : null;
        }

        private static decimal? ParseOdds(string raw)
        {
            raw = (raw ?? "").Trim();
            if (raw == "" || raw == "0000" || raw == "----" || raw == "****") return null;

            int value;
            if (!int.TryParse(raw, out value)) return null;
            if (value <= 0) return null;
            return Math.Round(value / 10m, 1);
        }

        private static string ResolveOddsStatus(string dataKubun, string winFlag)
        {
            if (dataKubun == "1" || dataKubun == "2" || dataKubun == "3") return "active";
            if (dataKubun == "4" || dataKubun == "5") return "closed";
            if (dataKubun == "9" || winFlag == "0") return "missing";
            return "active";
        }

        private static string BuildOddsUpdatedAt(string raceDate, string announce, string dataCreatedAt)
        {
            if (!string.IsNullOrWhiteSpace(announce) && announce.Length == 8)
            {
                return raceDate.Substring(0, 4) + "-" + announce.Substring(0, 2) + "-" + announce.Substring(2, 2)
                    + "T" + announce.Substring(4, 2) + ":" + announce.Substring(6, 2);
            }
            if (!string.IsNullOrWhiteSpace(dataCreatedAt) && dataCreatedAt.Length == 8)
            {
                return dataCreatedAt.Substring(0, 4) + "-" + dataCreatedAt.Substring(4, 2) + "-" + dataCreatedAt.Substring(6, 2);
            }
            return "";
        }

        private static string WriteOddsCsvSafely(string outputPath, List<OddsRow> rows)
        {
            var dir = Path.GetDirectoryName(outputPath);
            Directory.CreateDirectory(dir);
            var nextPath = Path.Combine(dir, "odds.next-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".csv");
            WriteOddsCsv(nextPath, rows);

            if (!File.Exists(outputPath))
            {
                File.Copy(nextPath, outputPath, true);
                return outputPath;
            }

            var backupDir = Path.Combine(dir, "_backup", DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Directory.CreateDirectory(backupDir);
            var backupPath = Path.Combine(backupDir, Path.GetFileName(outputPath));

            try
            {
                File.Replace(nextPath, outputPath, backupPath, true);
                return outputPath;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("WARN odds.csv could not be replaced: " + SafeMessage(ex));
                Console.Error.WriteLine("WARN Generated odds were kept at: " + nextPath);
                return nextPath;
            }
        }

        private static void WriteOddsCsv(string outputPath, List<OddsRow> rows)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
            using (var writer = new StreamWriter(outputPath, false, new UTF8Encoding(true)))
            {
                writer.WriteLine("場所,R,馬番,馬名,単勝オッズ,人気,取得時刻,更新元,状態");
                foreach (var row in rows)
                {
                    writer.WriteLine(string.Join(",", new[]
                    {
                        Csv(row.Race.CourseName),
                        Csv(row.Race.RaceNo.ToString()),
                        Csv(row.HorseNumber == null ? "" : row.HorseNumber.Value.ToString()),
                        Csv(row.HorseName),
                        Csv(row.WinOdds == null ? "" : row.WinOdds.Value.ToString("0.0")),
                        Csv(row.Popularity == null ? "" : row.Popularity.Value.ToString()),
                        Csv(row.UpdatedAt),
                        Csv(row.Source),
                        Csv(row.Status)
                    }));
                }
            }
        }

        private static string Csv(string value)
        {
            value = value ?? "";
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        }

        private static int ApplyHorseNames(string repoRoot, List<OddsRow> odds)
        {
            var manifestPath = Path.Combine(repoRoot, "tools", "jvlink", "output", "target-horses.json");
            var weekDataPath = Path.Combine(repoRoot, "tools", "week-data.json");
            var map = File.Exists(manifestPath)
                ? LoadHorseNameMapFromManifest(manifestPath)
                : new Dictionary<string, string>();
            if (File.Exists(weekDataPath))
            {
                foreach (var pair in LoadHorseNameMap(weekDataPath))
                {
                    if (!map.ContainsKey(pair.Key)) map[pair.Key] = pair.Value;
                }
            }
            var missing = 0;
            foreach (var row in odds)
            {
                if (row.HorseNumber == null) { missing++; continue; }
                string name;
                if (map.TryGetValue(HorseNameKey(row.Race.CourseName, row.Race.RaceNo, row.HorseNumber.Value), out name))
                {
                    row.HorseName = name;
                }
                if (string.IsNullOrWhiteSpace(row.HorseName)) missing++;
            }
            return missing;
        }

        private static int RunWeek(Options options, string repoRoot, string logPath)
        {
            var scriptPath = Path.Combine(repoRoot, "tools", "jvfetch", "run-week.ps1");
            if (!File.Exists(scriptPath))
            {
                Console.Error.WriteLine("Weekly acquisition script was not found: " + scriptPath);
                return 2;
            }

            var arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\"";
            if (options.AllRaces) arguments += " -AllRaces";
            if (!string.IsNullOrWhiteSpace(options.Races)) arguments += " -Races \"" + options.Races.Replace("\"", "") + "\"";

            Log(logPath, "INFO", "jvfetch --week started. allRaces=" + options.AllRaces + " races=" + (options.Races ?? "(config)"));
            var process = Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = arguments,
                WorkingDirectory = repoRoot,
                UseShellExecute = false
            });
            process.WaitForExit();
            Log(logPath, process.ExitCode == 0 ? "INFO" : "ERROR", "jvfetch --week exitCode=" + process.ExitCode);
            return process.ExitCode;
        }

        private static Dictionary<string, string> LoadHorseNameMapFromManifest(string manifestPath)
        {
            var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var root = serializer.DeserializeObject(File.ReadAllText(manifestPath, Encoding.UTF8)) as Dictionary<string, object>;
            var map = new Dictionary<string, string>();
            if (root == null || !root.ContainsKey("horses")) return map;

            var horses = root["horses"] as object[];
            if (horses == null) return map;
            foreach (var horseObj in horses)
            {
                var horse = horseObj as Dictionary<string, object>;
                if (horse == null) continue;
                var name = Convert.ToString(GetValue(horse, "horseName") ?? "");
                var entries = GetValue(horse, "entries") as object[];
                if (name == "" || entries == null) continue;
                foreach (var entryObj in entries)
                {
                    var entry = entryObj as Dictionary<string, object>;
                    if (entry == null) continue;
                    var courseName = CourseNameFromCode(Convert.ToString(GetValue(entry, "courseCode") ?? ""));
                    var raceNo = ToInt(GetValue(entry, "raceNo"));
                    var horseNo = ToInt(GetValue(entry, "horseNumber"));
                    if (courseName == "" || raceNo == null || horseNo == null) continue;
                    map[HorseNameKey(courseName, raceNo.Value, horseNo.Value)] = name;
                }
            }
            return map;
        }

        private static string CourseNameFromCode(string code)
        {
            switch (code)
            {
                case "01": return CourseInfo.FromSlug("sapporo").Name;
                case "02": return CourseInfo.FromSlug("hakodate").Name;
                case "03": return CourseInfo.FromSlug("fukushima").Name;
                case "04": return CourseInfo.FromSlug("niigata").Name;
                case "05": return CourseInfo.FromSlug("tokyo").Name;
                case "06": return CourseInfo.FromSlug("nakayama").Name;
                case "07": return CourseInfo.FromSlug("chukyo").Name;
                case "08": return CourseInfo.FromSlug("kyoto").Name;
                case "09": return CourseInfo.FromSlug("hanshin").Name;
                case "10": return CourseInfo.FromSlug("kokura").Name;
                default: return "";
            }
        }

        private static Dictionary<string, string> LoadHorseNameMap(string weekDataPath)
        {
            var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var root = serializer.DeserializeObject(File.ReadAllText(weekDataPath, Encoding.UTF8)) as Dictionary<string, object>;
            var map = new Dictionary<string, string>();
            if (root == null || !root.ContainsKey("races")) return map;

            var races = root["races"] as object[];
            if (races == null) return map;

            foreach (var raceObj in races)
            {
                var race = raceObj as Dictionary<string, object>;
                if (race == null) continue;

                var track = Convert.ToString(GetValue(race, "track") ?? "");
                var raceNo = ToInt(GetValue(race, "number"));
                var horses = GetValue(race, "horses") as object[];
                if (track == "" || raceNo == null || horses == null) continue;

                foreach (var horseObj in horses)
                {
                    var horse = horseObj as Dictionary<string, object>;
                    if (horse == null) continue;
                    var horseNo = ToInt(GetValue(horse, "number"));
                    var name = Convert.ToString(GetValue(horse, "name") ?? "");
                    if (horseNo == null || name == "") continue;
                    map[HorseNameKey(track, raceNo.Value, horseNo.Value)] = name;
                }
            }

            return map;
        }

        private static string HorseNameKey(string track, int raceNo, int horseNo)
        {
            return track + "|" + raceNo + "|" + horseNo;
        }

        private static object GetValue(Dictionary<string, object> dictionary, string key)
        {
            object value;
            return dictionary.TryGetValue(key, out value) ? value : null;
        }

        private static int? ToInt(object value)
        {
            if (value == null) return null;
            if (value is int) return (int)value;
            if (value is long) return (int)(long)value;
            if (value is decimal) return (int)(decimal)value;
            int parsed;
            return int.TryParse(Convert.ToString(value), out parsed) ? (int?)parsed : null;
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
            return InvokeIntWithArgs(target, name, args);
        }

        private static int InvokeIntWithArgs(object target, string name, object[] args)
        {
            var value = target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, args);
            return Convert.ToInt32(value);
        }

        private static int InvokeJvRead(object target, object[] args)
        {
            var modifiers = new ParameterModifier(3);
            modifiers[0] = true;
            modifiers[1] = false;
            modifiers[2] = true;
            var value = target.GetType().InvokeMember(
                "JVRead",
                BindingFlags.InvokeMethod,
                null,
                target,
                args,
                new[] { modifiers },
                null,
                null);
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
                else if (arg == "--all-races") options.AllRaces = true;
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
            Console.WriteLine("TURF MATRIX jvfetch");
            Console.WriteLine("Usage:");
            Console.WriteLine("  jvfetch.exe --check [--sid <JV-Link SID>] [--prog-id JVDTLab.JVLink]");
            Console.WriteLine("  jvfetch.exe --week [--races \"福島10,福島11\" | --all-races]");
            Console.WriteLine("  jvfetch.exe --odds-only  (fetch O1 win odds for tools/race-batch-config.json)");
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
            public bool AllRaces { get; set; }
            public List<string> UnknownArgs { get { return _unknownArgs; } }
        }

        private sealed class RaceTarget
        {
            public string RaceDate { get; set; }
            public string CourseSlug { get; set; }
            public string CourseCode { get; set; }
            public string CourseName { get; set; }
            public int RaceNo { get; set; }
            public string JvKey { get; set; }
            public string Label { get { return CourseName + RaceNo + "R"; } }
        }

        private sealed class OddsRow
        {
            public RaceTarget Race { get; set; }
            public int? HorseNumber { get; set; }
            public decimal? WinOdds { get; set; }
            public int? Popularity { get; set; }
            public string HorseName { get; set; }
            public string UpdatedAt { get; set; }
            public string Source { get; set; }
            public string Status { get; set; }
            public string DataKubun { get; set; }
            public int? Runners { get; set; }
        }

        private sealed class CourseInfo
        {
            public string Code { get; set; }
            public string Name { get; set; }

            public static CourseInfo FromSlug(string slug)
            {
                switch ((slug ?? "").ToLowerInvariant())
                {
                    case "sapporo": return New("01", "札幌");
                    case "hakodate": return New("02", "函館");
                    case "fukushima": return New("03", "福島");
                    case "niigata": return New("04", "新潟");
                    case "tokyo": return New("05", "東京");
                    case "nakayama": return New("06", "中山");
                    case "chukyo": return New("07", "中京");
                    case "kyoto": return New("08", "京都");
                    case "hanshin": return New("09", "阪神");
                    case "kokura": return New("10", "小倉");
                    default: throw new InvalidOperationException("Unsupported course slug: " + slug);
                }
            }

            private static CourseInfo New(string code, string name)
            {
                return new CourseInfo { Code = code, Name = name };
            }
        }
    }
}
