# Дневник — бэкенд кабинетов: регистрация, вход, хранение записей.
# Каждый кабинет — отдельный файл data/u_<логин>.json, пароли хранятся хэшами.
import json
import os
import re
import secrets
import time

from flask import Flask, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, 'data')
os.makedirs(DATA, exist_ok=True)
USERS_F = os.path.join(DATA, 'users.json')
TOKENS_F = os.path.join(DATA, 'tokens.json')

ORIGIN = 'https://laptevachristina.github.io'
MAX_DOC = 2_000_000
TOKEN_TTL = 60 * 24 * 3600  # 60 дней

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = MAX_DOC + 4096


def jload(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def jsave(path, value):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False)
    os.replace(tmp, path)


def ufile(login):
    return os.path.join(DATA, 'u_' + login + '.json')


def jerr(msg, code=400):
    return jsonify({'ok': False, 'error': msg}), code


@app.after_request
def add_cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = ORIGIN
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return resp


def new_token(login):
    tokens = jload(TOKENS_F, {})
    now = int(time.time())
    for t, v in list(tokens.items()):
        if now - v['t'] > TOKEN_TTL:
            del tokens[t]
    tok = secrets.token_hex(24)
    tokens[tok] = {'login': login, 't': now}
    jsave(TOKENS_F, tokens)
    return tok


def auth():
    h = request.headers.get('Authorization', '')
    tok = h[7:] if h.startswith('Bearer ') else ''
    v = jload(TOKENS_F, {}).get(tok)
    return v['login'] if v else None


@app.route('/healthz')
def healthz():
    return 'ok'


@app.route('/api/reg', methods=['POST', 'OPTIONS'])
def reg():
    if request.method == 'OPTIONS':
        return '', 204
    d = request.get_json(silent=True) or {}
    login = str(d.get('login', '')).strip().lower()
    password = str(d.get('password', ''))
    if not re.fullmatch(r'[a-z0-9_.-]{3,24}', login):
        return jerr('Логин: 3–24 символа, латинские буквы, цифры, точка, дефис')
    if len(password) < 6 or len(password) > 100:
        return jerr('Пароль: минимум 6 символов')
    users = jload(USERS_F, {})
    if login in users:
        return jerr('Этот логин уже занят, придумайте другой')
    users[login] = {'p': generate_password_hash(password), 't': int(time.time())}
    jsave(USERS_F, users)
    return jsonify({'ok': True, 'token': new_token(login), 'login': login})


@app.route('/api/login', methods=['POST', 'OPTIONS'])
def login_ep():
    if request.method == 'OPTIONS':
        return '', 204
    d = request.get_json(silent=True) or {}
    login = str(d.get('login', '')).strip().lower()
    password = str(d.get('password', ''))
    rec = jload(USERS_F, {}).get(login)
    if rec is None or not check_password_hash(rec['p'], password):
        time.sleep(0.6)  # притормозить подбор пароля
        return jerr('Неверный логин или пароль')
    return jsonify({'ok': True, 'token': new_token(login), 'login': login})


@app.route('/api/pull')
def pull():
    login = auth()
    if not login:
        return jerr('Нужно войти в кабинет', 401)
    saved = jload(ufile(login), None)
    if saved is None:
        return jsonify({'ok': True, 'doc': None, 'ts': 0})
    return jsonify({'ok': True, 'doc': saved.get('doc'), 'ts': saved.get('ts', 0)})


@app.route('/api/push', methods=['POST', 'OPTIONS'])
def push():
    if request.method == 'OPTIONS':
        return '', 204
    login = auth()
    if not login:
        return jerr('Нужно войти в кабинет', 401)
    d = request.get_json(silent=True) or {}
    doc = d.get('doc')
    if not isinstance(doc, dict) or not isinstance(doc.get('profile'), dict):
        return jerr('Неверный формат данных')
    if len(json.dumps(doc, ensure_ascii=False)) > MAX_DOC:
        return jerr('Дневник слишком большой, обратитесь в поддержку')
    ts = int(time.time() * 1000)
    jsave(ufile(login), {'doc': doc, 'ts': ts})
    return jsonify({'ok': True, 'ts': ts})


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8011)
