# SPDX-License-Identifier: Apache-2.0
"""Run the tests of the Blender scripts of the asset pipeline in Blender.

    bun run py:test        (Blender 5.2 in the background)

The runner finds the tests (`test_*.py`) in this folder and in each folder after `--` (for example the tests of a
project plugin). It puts the folder of the scripts of this package, each test folder and the parent of each test
folder on `sys.path`, so a test imports the scripts by name. The tests use the real bpy of Blender, so they need no
stubs. The exit code is 1 when a test fails.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
EXTRA = [os.path.abspath(folder) for folder in (sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])]
FOLDERS = [HERE, *EXTRA]

for folder in FOLDERS:
    for path in (os.path.dirname(folder), folder):
        if path not in sys.path:
            sys.path.insert(0, path)

suite = unittest.TestSuite()
for folder in FOLDERS:
    suite.addTests(unittest.defaultTestLoader.discover(folder, pattern="test_*.py", top_level_dir=folder))
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
