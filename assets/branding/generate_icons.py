"""Generate application icon formats from the approved project mark."""

from pathlib import Path

from PIL import Image


def main():
    root = Path(__file__).resolve().parents[2]
    with Image.open(root / "assets/branding/cursor-zh-logo.png") as source:
        icon = source.convert("RGBA")
        icon.resize((1024, 1024), Image.Resampling.LANCZOS).save(
            root / "build/appicon.png"
        )
        icon.save(
            root / "build/windows/icon.ico",
            sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)],
        )
        icon.resize((128, 128), Image.Resampling.LANCZOS).save(
            root / "frontend/dist/appicon.png"
        )


if __name__ == "__main__":
    main()
