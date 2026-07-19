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
- `--odds-only` command:
  - reads `tools/race-batch-config.json`
  - opens JV-Link realtime odds with `JVRTOpen("0B31", "YYYYMMDDJJRR")`
  - parses O1 win odds using `tools/jvlink/output/JV-Data4901.xlsx`
  - writes UTF-8 BOM CSV to `data/target/odds.csv`
  - preserves generated data at `data/target/odds.next.csv` if `odds.csv` cannot be replaced
  - fills horse names from read-only `tools/week-data.json` when available

Not implemented in Step1:

- RA/SE parsing
- `shutuba.csv`
- `pedigree.csv`
- `training.csv`
- `--week`

Those are Step2+ / later steps in the design.

## Build

```powershell
C:\Windows\Microsoft.NET\Framework\v4.0.30319\MSBuild.exe tools\jvfetch\TurfMatrix.JvFetch.csproj /p:Configuration=Release /p:Platform=x86
```

The output under `tools/jvfetch/bin/` is gitignored.

For normal operation, prefer the repository runner. It builds an x86 executable with a unique runtime name, which avoids local Windows file locks around `jvfetch.exe`.

```powershell
npm run jvfetch:check
npm run jvfetch:odds
```

## Check

```powershell
tools\jvfetch\bin\Release\jvfetch.exe --check
```

Optional:

```powershell
tools\jvfetch\bin\Release\jvfetch.exe --check --sid <JV-Link SID>
```

If `--sid` is omitted, `JVLINK_SID` is used. If neither is set, `UNKNOWN` is used so the COM/JVInit path can still be diagnosed.

## Odds Only

```powershell
tools\jvfetch\bin\Release\jvfetch.exe --odds-only
```

Recommended:

```powershell
npm run jvfetch:odds
npm run verify:jvfetch-odds
npm run jvfetch:adopt-odds
```

Input:

- `tools/race-batch-config.json`

Output:

- `data/target/odds.csv`
- `data/target/odds.next-YYYYMMDD-HHMMSS.csv` when the existing `odds.csv` cannot be replaced

CSV columns:

```text
場所,R,馬番,馬名,単勝オッズ,人気,取得時刻,更新元,状態
```

The O1 realtime record does not include horse names. `jvfetch` therefore uses the existing production `tools/week-data.json` as a read-only name map keyed by track, race number, and horse number. Odds and popularity values remain JV-Link-derived.

If `odds.csv` cannot be replaced, the command keeps the new file as `odds.next-YYYYMMDD-HHMMSS.csv` and exits with code `1`. This prevents downstream release scripts from silently using stale odds.

`npm run verify:jvfetch-odds` validates the latest `odds.next-*` file against `tools/race-batch-config.json` and the current runner counts in `tools/week-data.json`.

`npm run jvfetch:adopt-odds` copies the latest verified `odds.next-*` into `data/target/odds.csv` with a backup of the previous file. If the copy is blocked by Windows, it exits non-zero and leaves the candidate untouched.

Specification source:

- realtime dataspec: `0B31`
- record type: `O1`
- key format: `YYYYMMDDJJRR`
- O1 field positions: `tools/jvlink/output/JV-Data4901.xlsx`

Do not commit generated `data/target/` files.

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
