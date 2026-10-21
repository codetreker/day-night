import json
import os


configuration = json.loads(os.environ.pop("DAYNIGHT_NATIVE_CODEX_AUTH"))
os.environ["HOME"] = configuration["home"]
if configuration["codexHome"] is None:
    os.environ.pop("CODEX_HOME", None)
else:
    os.environ["CODEX_HOME"] = configuration["codexHome"]
for name in tuple(os.environ):
    if name.startswith("DAYNIGHT_NATIVE_CODEX_HEADER_"):
        del os.environ[name]
command = configuration["command"]
os.execvpe(command, [command, *configuration["args"]], os.environ)
