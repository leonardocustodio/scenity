# ADR 03: Asset identity

- Task: SE4-01 of `docs/generic-engine-plan.md`
- Date: 2026-10-15
- Status: **accepted (provisional)**. The owner can change it.

## Context

Today an asset is a slot name in a closed union (`PropSlot`, `DeviceSlot`, `npcIds`) and an entry that a person writes
by hand in `art/room3d/assets.json`. A rename of a file breaks its users, and a new asset needs code.

## Decision

1. **A stable ID per asset.** The ID is a ULID-like text of 10 to 26 characters from `[0-9A-Za-z_-]` (new assets get
   a ULID; converted assets keep their old name, for example `prop_defibrillator`). The ID never changes when the file
   moves or gets a new name.
2. **A record beside each source**: `<source file>.meta.json` with `format: "scenity.asset/1"`, `id`, `kind`,
   `source` (the file name, relative to the record), `importer`, `settings` (the schema of the importer), `rights`
   (a path to the rights record), `tags` and optional `approvals`. SE4-09 adds an optional `rig`: the rig profile of
   a skinned model or a clip (`ue5`, `rigify`, `vrm`, `mixamo`), or `none`; with no value the engine finds the profile
   from the bone names.
3. **Open kinds**: `model`, `skinned-model`, `animation`, `texture`, `material`, `environment`, `scene`, `prefab`,
   `audio` (SE6-13: the WAV, Ogg and MP3 importers copy the file; the build keeps the duration, the channels and the
   rate in the stats). A plugin can add a kind with a prefix (`resus.clip-family`).
4. **The asset database** finds the records under the asset roots of the project, keeps an index from ID to path,
   kind, hash, dependencies and outputs, and reports a broken reference.
5. **Outputs** are listed by the manifest (manifest 2, SE4-05: `scenity.manifest/2` with records `{ id, kind, lods,
files, bytes, sha256, stats, tags }`), which maps the ID to the files with their sizes and SHA-256. The record
   `sha256` is a hash over the file hashes, so it is the version of the asset. The file names stay `<id>.<tier>.glb`
   (implementation note, SE4-05): the record hash gives the version, so content-addressed names are not necessary.
6. **Rights** stay an engine feature: each record names a rights record, and the release gate checks the licence
   register. The project gives the rules (which licences it accepts) and the approval roles.

## Consequences

- The resus manifest converts to manifest 2 (SE4-05): characters and the patient are `skinned-model` records, props
  `model`, clips `animation` and room kits `scene`, with the group tags `resus.character`, `resus.patient`, `prop`,
  `clip` and `resus.room`, and value tags such as `resus.slot:<slot>`, `resus.family:<family>` and `resus.npc:<id>`
  (`plugins/resus/room/src/model/manifestTags.ts`). Converted IDs keep their old names, also when they are shorter
  than 10 characters (for example `prop_ett`).
- The runtime reads assets by ID and kind; no closed union of slots stays.
