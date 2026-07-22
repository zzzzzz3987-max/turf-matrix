# TURF MATRIX jvfetch

JV-Link direct fetch app scaffold for `docs/DESIGN-jvlink-fetch.md`.

## Implementation Status

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
  - resolves horse names from the current JV-Link `target-horses.json` manifest
  - uses read-only `tools/week-data.json` only as a legacy fallback
  - refuses to replace odds data if any horse name cannot be resolved
- weekly RA/SE acquisition adapter:
  - opens the official `RACE` dataspec through 32-bit JV-Link
  - reads RA race details and SE runner records
  - filters the races configured in `tools/race-batch-config.json`
  - writes `data/target/shutuba.csv`
  - writes one Normalizer-compatible `data/target/races/<bundle>/current-race-detail.csv` per configured race
  - writes `data/target/week-config.draft.json`
  - never updates production `tools/week-data.json`
- `--week` command:
  - provides the supported C# CLI entry point for the verified weekly adapter
  - uses `tools/race-batch-config.json` when no race option is supplied
  - accepts `--races "福島10,小倉11"` for an explicit subset
  - accepts `--all-races` for every race on the configured date
  - writes the selected race list only to ignored runtime output; the permanent config is not edited
- current-runner pedigree and training adapter:
  - opens `RCVN` and reads the official UM three-generation pedigree block
  - opens `SLOP` / HC for the 45 days ending on race day
  - opens `WOOD` / WC for the same period
  - joins records by blood registration number, never by display order
  - writes `data/target/pedigree.csv`, `training.csv`, `training-slope.csv`, and `training-wood.csv`
  - validates pedigree coverage, horse names, and training dates before success
- current-runner past-performance adapter:
  - reads official RCVN RA/SE records for the configured runners
  - joins by blood registration number and excludes the current race day
  - writes one Normalizer-compatible `data/target/races/<bundle>/all.csv` per configured race
  - leaves TARGET's proprietary ZI column empty; no replacement value is invented

Not implemented yet:

- moving the verified 32-bit PowerShell JV-Data record reader itself into C#

`pedigree.csv` and `training.csv` are now produced by the verified 32-bit
adapter. The remaining work is moving that already-operational adapter into the
C# executable without changing its output contract.

A separate HN cache is not required for the current four-line pedigree because
UM includes the named three-generation ancestor block; HN remains available for
future deeper ancestry expansion.

The weekly runner currently uses the existing verified 32-bit PowerShell JV-Link adapter for RA/SE acquisition, then a Node formatter for the existing TARGET-compatible files. This preserves Japanese JV-Data text correctly while the final C# COM binding is completed. The data source is JV-Link in both cases; no TARGET GUI or manually exported CSV is used.

## Build

```powershell
C:\Windows\Microsoft.NET\Framework\v4.0.30319\MSBuild.exe tools\jvfetch\TurfMatrix.JvFetch.csproj /p:Configuration=Release /p:Platform=x86
```

The output under `tools/jvfetch/bin/` is gitignored.

For normal operation, prefer the repository runner. It builds an x86 executable with a unique runtime name, which avoids local Windows file locks around `jvfetch.exe`.

```powershell
npm run jvfetch:check
npm run jvfetch:week
npm run jvfetch:odds
```

## Weekly Race Card

```powershell
npm run jvfetch:week
```

Direct C# CLI examples:

```powershell
# Existing configured races (currently each venue's 10R and 11R)
tools\jvfetch\bin\Release\jvfetch.exe --week

# Explicit subset
tools\jvfetch\bin\Release\jvfetch.exe --week --races "福島10,小倉11"

# Every race on the configured date
tools\jvfetch\bin\Release\jvfetch.exe --week --all-races
```

`--races` and `--all-races` are mutually exclusive. Selection is derived from
the RA records actually returned by JV-Link, so an unavailable race fails
without changing the permanent batch configuration or production week data.

Double-click operation:

```text
jvfetch.bat
```

Inputs:

- JV-Link `RACE` dataspec (RA / SE)
- JV-Link `RCVN` dataspec (UM current-runner master and named ancestors)
- JV-Link `SLOP` dataspec (HC slope training)
- JV-Link `WOOD` dataspec (WC wood-chip training)
- `tools/race-batch-config.json`

Ignored outputs:

- `tools/jvlink/output/week-race-summary.json`
- `data/target/shutuba.csv`
- `data/target/week-config.draft.json`
- `data/target/races/<bundle>/current-race-detail.csv`
- `data/target/races/<bundle>/all.csv`
- `data/target/pedigree.csv`
- `data/target/training.csv`
- `data/target/training-slope.csv`
- `data/target/training-wood.csv`

`week-config.draft.json` is deliberately a draft. Review and adopt it through the existing weekly pipeline; the command does not overwrite the production configuration or `tools/week-data.json`.

The race batch Normalizer keeps a manually exported bundle file as its first choice. If `tools/csv/input/races/<bundle>/current-race-detail.csv` is absent, it uses the direct JV-Link file under `data/target/races/<bundle>/`. This preserves the manual fallback while allowing the race card input to run without TARGET GUI export.

`npm run verify:jvfetch-week` can be rerun independently. It exits non-zero if
pedigree coverage is incomplete, a joined horse name differs, or a training
record falls outside the race-day/45-day window. Horses with no official HC/WC
record remain explicitly missing; data from another horse is never substituted.

`npm run verify:jvfetch-normalizer` passes only when every generated race card,
past-run file, pedigree file, and training file can be joined through the real
race-bundle Normalizer. It reads existing odds and TARGET ZI inputs only as
optional compatibility inputs and never writes production data.

The current adapter exists because late-bound C# RA/SE text marshalling did not preserve Japanese safely on the local JV-Link installation. It is an operational bridge for design Steps 2-3, not a change to the final .NET Framework 4.8 x86 architecture. Record positions remain sourced from `tools/jvlink/output/JV-Data4901.xlsx`; no byte layout is inferred.

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
