"""Rebuild analytics before serving, including on deployment."""
import os
import argparse
import shutil
import subprocess
import sys
from pathlib import Path
from dotenv import load_dotenv

if __name__ == '__main__':
    root = Path(__file__).resolve().parent
    load_dotenv(root / '.env', override=False, encoding='utf-8-sig')
    parser = argparse.ArgumentParser(description='Build and serve the full application')
    parser.add_argument('--skip-build', action='store_true', help='Use an existing frontend/out build')
    args = parser.parse_args()
    frontend = root / 'frontend'
    if not args.skip_build:
        npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
        if not npm:
            raise SystemExit('Install Node.js and npm, then run python start.py again.')
        if not (frontend / 'node_modules' / 'next').exists():
            subprocess.run([npm, 'ci', '--no-audit', '--no-fund'], cwd=frontend, check=True)
        build_env = os.environ.copy()
        build_env.update(NEXT_PUBLIC_USE_MOCKS='false', NEXT_PUBLIC_API_URL='', NEXT_TELEMETRY_DISABLED='1')
        subprocess.run([npm, 'run', 'build'], cwd=frontend, env=build_env, check=True)
    if not (frontend / 'out' / 'index.html').exists():
        raise SystemExit('Missing frontend/out/index.html; run python start.py without --skip-build.')
    os.environ['FRONTEND_DIR'] = str(frontend / 'out')
    subprocess.run([sys.executable, str(root / 'pipeline.py'), '--data', str(root / 'data'),
                    '--out', os.getenv('GRAPH_OUT', str(root / 'out'))], check=True, cwd=root)
    import uvicorn
    print(f"Open http://localhost:{os.getenv('PORT', '8000')}", flush=True)
    uvicorn.run('api:app', host='0.0.0.0', port=int(os.getenv('PORT', '8000')), app_dir=str(root))
