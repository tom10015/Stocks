"""Merge an automated share-count refresh into the latest main-branch dataset."""
import datetime, json, sys
from pathlib import Path

incoming=json.loads(Path(sys.argv[1]).read_text())
target=Path(sys.argv[2])
current=json.loads(target.read_text()) if target.exists() else {"companies":{}}
companies=current.setdefault("companies",{})
for ticker, update in incoming.get("companies",{}).items():
    saved=companies.get(ticker,{})
    old_history=saved.get("history") or []
    new_history=update.get("history") or []
    if not new_history and old_history:
        update={**update,"history":old_history,"status":"stale" if update.get("status") not in ("fund","ok") else update.get("status")}
    elif new_history and old_history:
        # Never replace SEC observations with lower-confidence snapshot observations.
        old_filing=any(h.get("form") in ("10-Q","10-K","20-F","40-F","10-Q/A","10-K/A") for h in old_history)
        new_filing=any(h.get("form") in ("10-Q","10-K","20-F","40-F","10-Q/A","10-K/A") for h in new_history)
        if old_filing and not new_filing and saved.get("type")!="fund":
            update={**update,"history":old_history,"status":saved.get("status","ok")}
        elif saved.get("type")=="fund" and update.get("type")=="fund":
            merged={(h.get("date"),h.get("shares"),h.get("form")):h for h in old_history+new_history}
            update={**update,"history":sorted(merged.values(),key=lambda h:(h.get("date") or "",h.get("checked_at") or ""))}
        elif not new_filing and update.get("status") in ("error","unavailable","stale"):
            update={**update,"history":old_history}
    # Keep every unique valid historical point, even when an incoming update is stale.
    if saved.get("type")=="fund" and update.get("type")=="fund" and old_history and new_history:
        merged={(h.get("date"),h.get("shares"),h.get("form")):h for h in old_history+new_history if h.get("date") and h.get("shares")}
        update={**update,"history":sorted(merged.values(),key=lambda h:(h.get("date") or "",h.get("checked_at") or ""))}
    if saved.get("yoy_pct") is not None and update.get("yoy_pct") is None:
        update["yoy_pct"]=saved["yoy_pct"]
    companies[ticker]={**saved,**update}
current["updated_at"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
target.parent.mkdir(parents=True,exist_ok=True)
target.write_text(json.dumps(current,indent=2)+"\n")
