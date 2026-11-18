"""Build the ZIP that users download from GitHub Releases."""

from pathlib import Path
import json
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    files = {"manifest.json", manifest["background"]["service_worker"]}
    files.update(manifest["icons"].values())
    action = manifest["action"]
    files.update(action["default_icon"].values())
    files.update({action["default_popup"], "popup.js"})
    files.update(rule["path"] for rule in manifest["declarative_net_request"]["rule_resources"])
    for script in manifest["content_scripts"]:
        files.update(script.get("js", []))
        files.update(script.get("css", []))

    for name in files:
        if not (ROOT / name).is_file():
            raise FileNotFoundError(name)

    output = ROOT / "dist" / "no-shorts-for-youtube.zip"
    output.parent.mkdir(exist_ok=True)
    staging = output.with_suffix(".tmp")
    with ZipFile(staging, "w", ZIP_DEFLATED) as archive:
        for name in sorted(files):
            archive.write(ROOT / name, name)
    staging.replace(output)
    print(output)


if __name__ == "__main__":
    main()
