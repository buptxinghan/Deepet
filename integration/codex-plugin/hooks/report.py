#!/usr/bin/env python3
"""Advisory event reporter. Never prints output or blocks a Codex operation."""
import hashlib,json,sys,urllib.request
from pathlib import Path

ALLOWED={'UserPromptSubmit','PreToolUse','PostToolUse','PermissionRequest','PreCompact','PostCompact','Stop','Interrupt','SessionEnd'}
def main():
    try:
        # Extract only event metadata; never retain or forward prompt or tool contents.
        incoming=sys.stdin.buffer.read(2*1024*1024+1)
        if len(incoming)>2*1024*1024:return
        payload=json.loads(incoming)
        event=payload.get('hook_event_name');session=payload.get('session_id')
        if event not in ALLOWED or not isinstance(session,str):return
        runtime=json.loads((Path.home()/'Library/Application Support/Deepet/runtime.json').read_text())
        port=runtime.get('port')
        if not isinstance(port,int) or not 1024<=port<=65535:return
        body=json.dumps({'event':event,'session_id':hashlib.sha256(session.encode()).hexdigest()[:24]}).encode()
        request=urllib.request.Request('http://127.0.0.1:'+str(port)+'/api/v1/events',data=body,headers={'Content-Type':'application/json','Authorization':'Bearer '+runtime['token']},method='POST')
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(request,timeout=0.35) as response:response.read(256)
    except Exception:pass
if __name__=='__main__':main()
