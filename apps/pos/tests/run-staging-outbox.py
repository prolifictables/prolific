#!/usr/bin/env python3
"""Connected E2E: fresh temporary mongod + PHP Kernel, real SQLite/HTTP, no project dotenv."""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
PHP = shutil.which('php')
MONGOD = shutil.which('mongod')
assert PHP and MONGOD, 'php and mongod must be installed'
# Refuse to reuse a listening service, even if it happens to be another test.
for port in (27991, 18787):
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', port))
work = Path(tempfile.mkdtemp(prefix='prolific-outbox-e2e-')).resolve()
(work / 'mongo').mkdir()
api = work / 'api'
(api / 'bin/staging').mkdir(parents=True)
(api / 'vendor').symlink_to(ROOT / 'php-api/vendor', target_is_directory=True)
for name in ('outbox-http-router.php', 'outbox-e2e-fixtures.php'):
    shutil.copy2(ROOT / 'php-api/bin/staging' / name, api / 'bin/staging' / name)
(api / '.env.staging').write_text('MONGODB_DATABASE=prolific_staging\nMONGODB_URI=mongodb://127.0.0.1:27991/?replicaSet=menu-price-test\nAPP_DEBUG=false\n')
# Do not inherit database, auth, proxy, or production environment configuration.
env = {'PATH': os.environ['PATH'], 'TMPDIR': tempfile.gettempdir(), 'PROLIFIC_OUTBOX_DBPATH': str(work / 'mongo')}
processes = []
logs = []
def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, env=env, check=True, **kwargs)
try:
    mongo_log = open(work / 'mongo.log', 'w'); logs.append(mongo_log)
    processes.append(subprocess.Popen([MONGOD, '--dbpath', str(work / 'mongo'), '--bind_ip', '127.0.0.1', '--port', '27991', '--replSet', 'menu-price-test', '--nounixsocket'], stdout=mongo_log, stderr=subprocess.STDOUT, env=env))
    bootstrap = work / 'init.php'
    bootstrap.write_text('''<?php
require $argv[1];
$c = new MongoDB\\Client('mongodb://127.0.0.1:27991/?directConnection=true', ['serverSelectionTimeoutMS'=>500]);
$a=$c->selectDatabase('admin');
for($i=0;$i<40;$i++){try{$o=$a->command(['getCmdLineOpts'=>1])->toArray()[0];break;}catch(Throwable){usleep(250000);}}
if(($o['parsed']['storage']['dbPath']??null)!==$argv[2])throw new RuntimeException('Unexpected database process');
$a->command(['replSetInitiate'=>['_id'=>'menu-price-test','members'=>[['_id'=>0,'host'=>'127.0.0.1:27991']]]])->toArray();
for($i=0;$i<80;$i++){if($a->command(['hello'=>1])->toArray()[0]['isWritablePrimary']??false)exit(0);usleep(250000);}
throw new RuntimeException('Replica set did not become writable');
''')
    run([PHP, str(bootstrap), str(ROOT / 'php-api/vendor/autoload.php'), str(work / 'mongo')], stdout=subprocess.DEVNULL)
    run([PHP, str(api / 'bin/staging/outbox-e2e-fixtures.php'), 'seed'], stdout=subprocess.DEVNULL)
    php_log = open(work / 'php.log', 'w'); logs.append(php_log)
    processes.append(subprocess.Popen([PHP, '-S', '127.0.0.1:18787', str(api / 'bin/staging/outbox-http-router.php')], cwd=api, env=env, stdout=php_log, stderr=subprocess.STDOUT))
    for _ in range(50):
        try:
            with socket.create_connection(('127.0.0.1', 18787), timeout=.2): break
        except OSError: time.sleep(.1)
    else: raise RuntimeError('PHP server did not start')
    bundle = work / 'staging-outbox.cjs'
    run([str(ROOT / 'node_modules/.bin/esbuild'), 'apps/pos/tests/staging-outbox.ts', '--bundle', '--platform=node', '--format=cjs', '--packages=external', '--outfile=' + str(bundle)])
    env.update({'PROLIFIC_OUTBOX_STAGING_TEST':'1', 'PROLIFIC_OUTBOX_STAGING_URL':'http://127.0.0.1:18787/api/v1', 'PROLIFIC_OUTBOX_FIXTURES':str(api / 'bin/staging/outbox-e2e-fixtures.php'), 'NODE_PATH':str(ROOT / 'node_modules'), 'ELECTRON_RUN_AS_NODE':'1'})
    electron = ROOT / 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    if not electron.exists(): electron = ROOT / 'node_modules/electron/dist/electron'
    run([str(electron), str(bundle)])
    # All DB-backed PHP tests use this same fixed loopback replica set, separate synthetic databases.
    env['PROLIFIC_LOCAL_PRICE_TESTS'] = '1'
    run([PHP, 'php-api/vendor/bin/phpunit', '--do-not-cache-result', '--bootstrap', 'php-api/vendor/autoload.php', 'php-api/tests'])
finally:
    for process in reversed(processes):
        process.terminate()
        try: process.wait(timeout=15)
        except subprocess.TimeoutExpired: process.kill(); process.wait()
    for log in logs: log.close()
    print('Isolated services stopped. Synthetic evidence/log directory:', work)
