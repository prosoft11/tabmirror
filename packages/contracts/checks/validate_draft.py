import json, copy
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
root=Path(__file__).resolve().parents[3]
schema=json.loads((root/'packages/contracts/snapshot.schema.json').read_text())
Draft202012Validator.check_schema(schema)
v=Draft202012Validator(schema,format_checker=FormatChecker())
for name in ('mixed','empty'):
 v.validate(json.loads((root/f'packages/contracts/examples/{name}.json').read_text()))
base=json.loads((root/'packages/contracts/examples/mixed.json').read_text())
cases=[]
def case(name,mutate):
 b=copy.deepcopy(base); mutate(b); cases.append((name,b))
case('forged owner',lambda x:x.update(ownerId='attacker'))
case('wrong version',lambda x:x.update(schemaVersion=2))
case('invalid timestamp',lambda x:x.update(capturedAt='tomorrowZ'))
case('invalid UUID',lambda x:x.update(browserSessionId='not-a-uuid'))
case('zero revision',lambda x:x.update(revision=0))
case('unsafe integer',lambda x:x.update(revision=9007199254740992))
case('unsupported URL',lambda x:x['windows'][0]['tabs'][0].update(url='javascript:alert(1)'))
case('extra tab data',lambda x:x['windows'][0]['tabs'][0].update(cookie='secret'))
case('empty included window',lambda x:x['windows'][0].update(tabs=[]))
case('too many windows',lambda x:x.update(windows=x['windows']*11))
case('unknown group color',lambda x:x['windows'][0]['groups'][0].update(color='black'))
case('oversized title',lambda x:x['windows'][0]['tabs'][0].update(title='x'*8193))
for name,b in cases:
 assert list(v.iter_errors(b)),f'Failed to reject {name}'
# Check cross-reference/order/URL properties of examples separately; not a production semantic validator.
from urllib.parse import urlsplit
for name in ('mixed','empty'):
 b=json.loads((root/f'packages/contracts/examples/{name}.json').read_text())
 assert len(json.dumps(b).encode())<=2097152
 assert sum(len(w['tabs']) for w in b['windows'])<=1000
 assert sum(len(w['groups']) for w in b['windows'])<=100
 assert [w['id'] for w in b['windows']]==sorted(set(w['id'] for w in b['windows']))
 tids=set(); gids=set()
 for w in b['windows']:
  local={g['id'] for g in w['groups']}; assert not gids&local; gids |= local
  assert len(local)==len(w['groups'])
  indices=[t['index'] for t in w['tabs']]; assert indices==sorted(set(indices))
  seen=[]; last=None
  for t in w['tabs']:
   assert t['id'] not in tids; tids.add(t['id'])
   p=urlsplit(t['url']); assert p.scheme in ('http','https') and p.hostname and not p.username and not p.password
   g=t['groupId']; assert g is None or g in local
   if g is not None and g!=last: assert g not in seen; seen.append(g)
   last=g
  assert seen==[g['id'] for g in w['groups']]
print('PASS: Draft 2020-12 schema; 2 valid examples; 12 invalid-payload checks; example aggregate/reference/order/URL checks')
