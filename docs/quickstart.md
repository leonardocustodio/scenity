# Quickstart

This page takes you from nothing to a saved, checked and built scene in Scenity Studio. You make a project, add a
model, a light and a camera, save the scene, check its rules, build it, take a picture of it and check its rights. After
`scenity studio` each step is in the browser. It takes about 15 minutes.

You need:

- [Bun](https://bun.sh) 1.4.2 or later, on macOS or Linux.
- A browser: Chromium, Chrome or Firefox.
- A model file in glTF Binary form (`.glb`) that you may use. The robot of the checkout is a good first model:
  `samples/characters/assets/sources/RobotExpressive/RobotExpressive.glb` (CC0, by Quaternius).

## 1. Get the `scenity` command

The packages are not on npm yet, so get the command from a checkout:

```sh
git clone https://github.com/leonardocustodio/scenity.git
cd scenity
bun install
bun run generate
alias scenity="bun $PWD/packages/cli/src/cli.ts"
```

The alias lasts for this shell. Once the packages are published, `bunx @scenity/cli studio` in any folder does the
same as step 2.

## 2. Start Scenity Studio

```sh
scenity studio
```

The browser opens on the Hub of the studio. This is the last command of this page: keep the terminal open, and use
the browser for the rest. [studio.md](studio.md) is the manual of the studio.

The first start shows **Welcome to Scenity Studio**. Choose the look and the language, read how to connect an agent,
and look at **Check this machine**. For the picture of step 9 the studio needs Chromium: if its line says that it is
missing, press **Install Chromium**. You can do this later in **Settings → This machine**.

## 3. Make a project

1. Press **New project** at the top of the Hub.
2. Choose the template **Empty**: a floor, a box, two lights and a camera.
3. Type `demo` in **Name**. **Place** shows where the folder goes; **Choose…** changes it.
4. Keep **Make a Git repository** on, and **Link the packages of this checkout**.
5. Press **Make**.

A job makes the project, installs its packages and starts Git. Then the editor window opens with the scene: the
hierarchy on the left, the inspector on the right, the Scene view in the middle and the Project panel at the bottom.
The tour of the window starts; **Next** goes through its six steps, and **Help → Take the tour** shows it again.

The project folder holds `scenity.project.json` (the project: its scenes, asset folders, licences and one rule),
`scenes/main.scene.json` (the scene), `assets/` (your files and their asset records) and `rights/` (the rights records
of your assets).

To look around in the Scene view: drag with the right button to look, use W A S D to fly, and scroll to zoom. F frames
the selection.

## 4. Add a model

1. In the **Project** panel at the bottom, press **Import** and choose `RobotExpressive.glb`.
2. The import dialog shows the **Rights record** (`rights/imports.yaml`: the licence is not known yet) and the
   **Folder** (`assets/sources`). Press **Import**. A tile of the model comes into the panel.
3. Drag the tile onto the floor in the Scene view. The robot stands where you drop it, and a new entity is in the
   hierarchy.
4. The robot is large. Select it, and in the inspector set **Transform → Scale** to `0.25` on each axis.

You can also drop the `.glb` file from your file manager onto the Scene view: that imports it and adds it in one step.

## 5. Add a light

1. Right-click an empty part of the hierarchy and choose **Add an empty entity**. The new entity is selected.
2. Press F2, type `Lamp` and press Enter. The name changes; the ID stays.
3. At the bottom of the inspector, type `light` in **Add component…** and choose **Light**.
4. Set **Type** to `point`, **Intensity** to `3` and **Range** to `6`.
5. Set **Transform → Position** to `1`, `2`, `1`.

**Entity → Create** has ready entities too, for example **Create a point light**.

## 6. Add a camera

1. Choose **Entity → Create → Create a camera**. Name it `Side` in the **Name** field of the inspector.
2. Set **Field of view** to `40` and **Transform → Position** to `3`, `1.6`, `3`.
3. Set **Target** to a point, then to `0`, `0.5`, `0`. A camera with no target looks along its −Z axis. A small
   preview of the selected camera shows in the corner of the view.

The **Cameras** overlay of the view lists the cameras of the scene. Keys 1 to 9 open them, and 0 goes back to the
editor camera.

## 7. Save

Press ⌘S (Ctrl+S on Linux), or **File → Save**. The file bar shows "saved", and the scene file holds the new entities.
Each value that is not a default is in the file, in a canonical order, so a small change gives a small diff. The
**Version control** panel (⌘⇧G) shows the change of the scene entity by entity; pick the files and commit them there.

A save runs the rules of the project first. A rule at the level `block` that fails stops the save. The dialog names
the rule and gives a field for a reason: **Save with the reason** saves anyway and keeps the reason in a log next to
the scene.

## 8. Check the rules and build

1. Open the **Problems** panel at the bottom and press **Run scenity check**. The check measures each rule of the
   project. The new project has one rule, `boxNearCentre`: it passes while the box stays within 1 m of the centre of
   the floor. The **Rules** panel shows the state of each rule as you edit.
2. Choose the workspace **Build** at the top of the window. In the **Build** panel, press **Run the build**. The build
   writes a static site to `dist/` in the project: the player, the documents and the built assets. It checks the size
   budgets and that no editor code is in the build.
3. Press **Open the built player** to see the scene as a visitor sees it.

## 9. Take a picture

In the Build workspace, open the **Shots** panel at the bottom. Type `Side` in **Camera**, keep the size `1280x800`
and press **Take a shot**. The studio draws one frame in the built player and shows the picture in the panel; the file
is in `test-results/shots/` of the project. **Add as a baseline** keeps it as a reference, and **Run verify** compares
the scene with its baselines later.

## 10. Record the rights and publish

The robot still points at `rights/imports.yaml`, which says "licence not known". A release check stops it until you
record its licence.

1. Choose the workspace **Assets** and open the **Rights** panel at the bottom. Press **New record…** and fill in:
   - **Name**: `quaternius`
   - **Source**: `Quaternius, Robot Expressive, https://quaternius.com`
   - **Author**: `Quaternius`
   - **SPDX ID**: `CC0-1.0`, and **Licence**: `CC0 1.0 Universal (public domain dedication)`
   - **Licence date**: today; **Allowed use**: web; **Web delivery**: Allowed

   Then press **Save the record**. The record is `rights/quaternius.yaml`.

2. In the **Project** panel, ⌘-click (Ctrl-click on Linux) the tile of the robot. The bar "1 assets picked" shows:
   choose `quaternius` in **Rights record** and press **Give the rights record**.
3. Choose **Window → Release check** and press **Run the release check**. It passes when each asset has a rights
   record with a licence that the project accepts (the new project accepts `CC0-1.0`). A finding has a button that
   opens the place to fix it.
4. Back in the Build workspace, press **Publish as a ZIP archive** in the Build panel. The release check runs first;
   then **Download the archive** gives the site to put on any static web server.

## If something goes wrong

- **The shot fails.** The studio needs Chromium: **Settings → This machine** in the Hub has **Install Chromium**.
- **The release check fails with "web delivery … not confirmed" or "no SPDX ID".** The asset still points at
  `rights/imports.yaml`. Give it a real rights record (step 10).
- **The save says "not saved: a rule fails".** A `block` rule of the project fails, and the dialog names it. Fix the
  scene, or give a reason to save anyway.
- **The browser says that it has no session.** Run `scenity studio` again; it opens the browser with a new launch
  link.

## Next steps

- [studio.md](studio.md): the Hub, the editor window, agents, jobs, version control, plugins and trust.
- [editor.md](editor.md): the whole editor (prefabs, materials, the sequencer, play mode, rules, keys).
- The **Agent** panel: ask an agent to "add four chairs around the table", then review its changes.
- [formats.md](formats.md): the files that you just wrote, and their JSON Schemas.
- [cli.md](cli.md): every `scenity` command, for scripts and CI (`scenity check`, `scenity build`, `scenity shot`).
- [plugins.md](plugins.md): your own components and systems.
