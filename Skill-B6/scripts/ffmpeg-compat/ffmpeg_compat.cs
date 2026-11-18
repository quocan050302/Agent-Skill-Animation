using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

// App-owned compatibility shim for FFmpeg 9.0+, which removed the deprecated `-vsync` flag.
// Upstream `b6_motion_review.py` (whose SHA-256 is locked by `b6_production.py`) calls
// `ffmpeg ... -vsync vfr ...`. Rather than mutating upstream vendor files, this shim
// translates `-vsync <mode>` to `-fps_mode <mode>` and forwards everything else identically.
internal static class Program
{
    private static string QuoteArg(string arg)
    {
        if (arg.Length == 0) return "\"\"";
        bool needsQuotes = false;
        foreach (char c in arg)
        {
            if (char.IsWhiteSpace(c) || c == '"')
            {
                needsQuotes = true;
                break;
            }
        }
        if (!needsQuotes) return arg;

        var sb = new StringBuilder();
        sb.Append('"');
        int backslashes = 0;
        foreach (char c in arg)
        {
            if (c == '\\')
            {
                backslashes++;
            }
            else if (c == '"')
            {
                sb.Append('\\', backslashes * 2 + 1);
                sb.Append('"');
                backslashes = 0;
            }
            else
            {
                if (backslashes > 0)
                {
                    sb.Append('\\', backslashes);
                    backslashes = 0;
                }
                sb.Append(c);
            }
        }
        if (backslashes > 0)
        {
            sb.Append('\\', backslashes * 2);
        }
        sb.Append('"');
        return sb.ToString();
    }

    private static int Main(string[] args)
    {
        var realFfmpeg = Environment.GetEnvironmentVariable("B6_REAL_FFMPEG");
        if (string.IsNullOrWhiteSpace(realFfmpeg) || !File.Exists(realFfmpeg))
        {
            var selfDir = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\');
            var pathVar = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            foreach (var dir in pathVar.Split(Path.PathSeparator))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                string fullDir;
                try { fullDir = Path.GetFullPath(dir).TrimEnd('\\'); } catch { continue; }
                if (string.Equals(fullDir, selfDir, StringComparison.OrdinalIgnoreCase)) continue;
                var candidate = Path.Combine(fullDir, "ffmpeg.exe");
                if (File.Exists(candidate))
                {
                    realFfmpeg = candidate;
                    break;
                }
            }
        }

        if (string.IsNullOrWhiteSpace(realFfmpeg) || !File.Exists(realFfmpeg))
        {
            Console.Error.WriteLine("B6 ffmpeg-compat shim: cannot locate real ffmpeg.exe");
            return 127;
        }

        var translated = new List<string>(args.Length);
        for (int i = 0; i < args.Length; i++)
        {
            translated.Add(args[i] == "-vsync" ? "-fps_mode" : args[i]);
        }

        var quotedArgs = new string[translated.Count];
        for (int i = 0; i < translated.Count; i++)
        {
            quotedArgs[i] = QuoteArg(translated[i]);
        }

        var psi = new ProcessStartInfo
        {
            FileName = realFfmpeg,
            Arguments = string.Join(" ", quotedArgs),
            UseShellExecute = false,
        };

        using (var proc = Process.Start(psi))
        {
            if (proc == null) return 1;
            proc.WaitForExit();
            return proc.ExitCode;
        }
    }
}
