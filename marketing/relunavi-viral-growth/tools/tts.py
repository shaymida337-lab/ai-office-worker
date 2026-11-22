import asyncio, ssl, sys
import edge_tts.communicate as c
c._SSL_CTX = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
import edge_tts
async def main(text, out, rate):
    com = edge_tts.Communicate(text, "he-IL-HilaNeural", rate=rate, boundary="WordBoundary")
    sm = edge_tts.SubMaker()
    with open(out, "wb") as f:
        async for ch in com.stream():
            if ch["type"] == "audio": f.write(ch["data"])
            elif ch["type"] in ("WordBoundary","SentenceBoundary"): sm.feed(ch)
    open(out.rsplit(".",1)[0]+".words.srt","w").write(sm.get_srt())
asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv)>3 else "+0%"))
