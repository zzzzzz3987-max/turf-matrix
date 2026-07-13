# JV-Link direct intake

This directory is the Windows-only entry point for reading JRA-VAN Data Lab data without automating the TARGET UI.

## Current stage

The detection commands only detect and initialize the installed JV-Link COM component. They do not download race data, read the service key, or update `week-data.json`.

```powershell
npm run detect:jvlink
npm run probe:jvlink
```

The weekly inspection command opens the official `RACE` data set from the Monday of the date configured in `tools/race-batch-config.json`:

```powershell
npm run inspect:jvlink-week
```

It may download data into JV-Link's managed cache. It reports only record identifiers, lengths, and counts. It never writes raw record bodies into this repository and never updates a candidate or production JSON file.

The weekly export command reads the same data and writes a parsed safety summary:

```powershell
npm run export:jvlink-week
```

Output:

```text
tools/jvlink/output/week-race-summary.json
```

This file is ignored by git. It contains only selected RA/SE fields needed to verify race and runner coverage. It does not update `tools/week-data.json`, does not generate a release candidate, and does not store raw JV-Data records.

`export:jvlink-week` returns a non-zero exit code when the configured race date is not present in the official `RACE` records. This is intentional. For example, if `tools/race-batch-config.json` points to the next Sunday before that week's race card has been distributed, the command returns `status: "target-missing"` and stops the direct pipeline.

JV-Link is a 32-bit ActiveX COM component. The CLI automatically relaunches itself with 32-bit Windows PowerShell when npm starts it from a 64-bit process.

Expected successful probe:

```json
{
  "action": "probe",
  "status": "ready",
  "architecture": "x86",
  "progId": "JVDTLab.JVLink",
  "version": "0490",
  "initResult": 0,
  "dataDownloaded": false,
  "serviceKeyRead": false
}
```

## Planned boundary

```text
JV-Link
  -> raw record reader
  -> tools/normalizers
  -> Intelligence Layer
  -> week-data candidate
  -> existing release gate
```

The existing TARGET CSV pipeline remains the fallback until direct acquisition produces the same normalized contract and passes multi-race regression checks.

The weekly inspection must contain both `RA` race records and `SE` runner records before it returns `ready`. The next implementation stage is a fixed-width RA/SE parser, followed by an RCOV adapter for horse master and historical race records.

Implemented direct-intake stages:

1. `detect:jvlink` verifies the 32-bit COM component is installed.
2. `probe:jvlink` verifies `JVInit` succeeds.
3. `inspect:jvlink-week` verifies official `RACE` data has RA/SE records.
4. `export:jvlink-week` exports an ignored summary JSON from RA/SE and fails safely when the configured race date is missing.

Not implemented yet:

- production `week-data.json` generation from JV-Link
- RCOV horse master / historical race adapter
- training and pedigree extraction from JV-Link
- Intelligence Layer connection
- odds release gate replacement

## Safety rules

- Do not read or log `m_servicekey`.
- Do not commit raw JV-Data records.
- Do not update production `tools/week-data.json` from an unvalidated direct acquisition.
- Do not estimate unavailable odds or race fields.
- Keep Thursday pre-odds and Saturday odds-complete release stages separate.
- Treat `target-missing` as a safe stop, not as a data generation success.
