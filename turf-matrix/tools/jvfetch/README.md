# TURF MATRIX jvfetch

JV-Link direct fetch app scaffold for `docs/DESIGN-jvlink-fetch.md`.

## Step1 Scope

Implemented now:

- C# console app targeting .NET Framework 4.8
- x86-only build
- late-bound COM activation for local JV-Link ProgID
- `--check` command:
  - verifies the process is x86
  - creates `JVDTLab.JVLink`
  - reads `m_JVLinkVersion`
  - calls `JVInit`
  - writes diagnostics to `data/target/jvfetch-log.txt`

Not implemented in Step1:

- RA/SE parsing
- `shutuba.csv`
- `pedigree.csv`
- `training.csv`
- `odds.csv`
- `--week`
- `--odds-only`

Those are Step6+ / later steps in the design.

## Build

```powershell
C:\Windows\Microsoft.NET\Framework\v4.0.30319\MSBuild.exe tools\jvfetch\TurfMatrix.JvFetch.csproj /p:Configuration=Release /p:Platform=x86
```

The output under `tools/jvfetch/bin/` is gitignored.

## Check

```powershell
tools\jvfetch\bin\Release\jvfetch.exe --check
```

Optional:

```powershell
tools\jvfetch\bin\Release\jvfetch.exe --check --sid <JV-Link SID>
```

If `--sid` is omitted, `JVLINK_SID` is used. If neither is set, `UNKNOWN` is used so the COM/JVInit path can still be diagnosed.

## Confirmed Local COM Registration

- ProgID: `JVDTLab.JVLink`
- Versioned ProgID: `JVDTLab.JVLink.1`
- CLSID: `{2AB1774D-0C41-11D7-916F-0003479BEB3F}`
- TypeLib: `{2AB17740-0C41-11D7-916F-0003479BEB3F}`
- TypeLib version: `1.12`
- InprocServer32: `C:\WINDOWS\SysWow64\JVDTLAB\JVDTLab.dll`

These values were read from the local Windows registry, not guessed.

Note: this machine does not have the Windows SDK AxImp tooling required for MSBuild COM wrapper generation.
Step1 therefore uses late-bound COM activation while preserving the confirmed JV-Link registry metadata above.
