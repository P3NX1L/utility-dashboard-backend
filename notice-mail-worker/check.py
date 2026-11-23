import asyncio
from playwright.async_api import async_playwright
from appfolio import ORIGIN, prepare
async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        events = []
        search = """<input id=global-search-input><ul role=listbox aria-label="Typeahead menu"><li role=option><a href="/occupancies/1/selected_tenant/2">Alex Example</a><div>100 Example St Unit 2 Chicago, IL</div></li></ul>"""
        profile = """<a href="#" aria-label="email" onclick="document.querySelector('form').hidden=false">Mail</a><form hidden><textarea id=email_recipients>test@example.invalid</textarea><input id=email_subject><textarea id=email_message></textarea><button id=send_button>Send</button><input type=file id=power-attachments-file-upload-button onchange="fetch('/attachments',{method:'POST',body:this.files[0]}).then(()=>document.querySelector('output').innerText=this.files[0].name)"><output></output></form>"""
        async def mock(route):
            u=route.request.url
            events.append((route.request.method,u))
            if u==ORIGIN+"/": await route.fulfill(content_type="text/html", body=search)
            elif u==ORIGIN+"/occupancies/1/selected_tenant/2": await route.fulfill(content_type="text/html",body=profile)
            elif u==ORIGIN+"/attachments": await route.fulfill(status=201,body="ok")
            else: await route.abort()
        await page.route("**/*",mock)
        args=("Example, Alex", "100 Example St, Unit 2, Chicago, IL 60600","Access Notice","Example dates","access.pdf",b"%PDF-synthetic")
        assert await prepare(page,*args)=="test@example.invalid"
        assert await page.locator('#email_subject').input_value()=="Access Notice"
        assert await page.locator('output').inner_text()=="access.pdf"
        assert [u for method,u in events if method=="POST"]==[ORIGIN+"/attachments"]
        try: await prepare(page,args[0],args[1].replace("Unit 2","Unit 3"),*args[2:])
        except ValueError: pass
        else: raise AssertionError("wrong unit accepted")
        await browser.close()
asyncio.run(main())
