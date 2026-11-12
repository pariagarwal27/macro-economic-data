from pathlib import Path
import sys

MODEL_ROOT = Path(__file__).resolve().parent
SCRIPTS = MODEL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from forecast_nfp import main  # noqa: E402


if __name__ == "__main__":
    main()