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

## Safety rules

- Do not read or log `m_servicekey`.
- Do not commit raw JV-Data records.
- Do not update production `tools/week-data.json` from an unvalidated direct acquisition.
- Do not estimate unavailable odds or race fields.
- Keep Thursday pre-odds and Saturday odds-complete release stages separate.
