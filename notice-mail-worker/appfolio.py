"""Browser actions for First Western's staff email composer."""
import re
from urllib.parse import urlsplit

ORIGIN = "https://firstw.appfolio.com"
PROFILE = re.compile(r"^/occupancies/\d+/selected_tenant/\d+/?$")


def words(value):
    return re.findall(r"[a-z0-9]+", value.casefold())


def same_person(left, right):
    def ordered(value):
        if "," in value:
            last, given = value.split(",", 1)
            value = given + " " + last
        return words(value)
    return ordered(left) == ordered(right)


def same_address(actual, expected):
    # Some AppFolio search cards omit the ZIP present in the directory.
    a, b = words(actual), words(expected)
    return a == b or (len(b) > 1 and re.fullmatch(r"\d{5}", b[-1]) and a == b[:-1])


async def prepare(page, tenant, address, subject, body, filename, pdf):
    await page.goto(ORIGIN)
    search = page.locator("#global-search-input")
    name_parts = tenant.split(",", 1)
    query = " ".join(part.strip() for part in reversed(name_parts))
    await search.fill(query)
    menu = page.get_by_role("listbox", name="Typeahead menu")
    links = menu.locator('a[href*="/selected_tenant/"]')
    await links.first.wait_for(timeout=15000)
    matches = set()
    for link in await links.all():
        if not same_person(await link.inner_text(), tenant):
            continue
        url = urlsplit(await link.get_attribute("href"))
        if url.netloc not in ("", "firstw.appfolio.com") or not PROFILE.fullmatch(url.path):
            continue
        card = link.locator('xpath=ancestor::*[@role="option"][1]')
        if any(same_address(line, address) for line in (await card.inner_text()).splitlines()):
            matches.add(url.path)
    if len(matches) != 1:
        raise ValueError("Could not match one tenant and unit in AppFolio.")
    await page.goto(ORIGIN + matches.pop())
    await page.get_by_role("link", name="email", exact=True).click()
    recipient = (await page.locator("#email_recipients").input_value()).strip()
    if not re.fullmatch(r"[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+", recipient):
        raise ValueError("AppFolio must show one recipient email.")
    await page.locator("#email_subject").fill(subject)
    await page.locator("#email_message").fill(body)
    def uploaded(response):
        return (response.request.method in ("POST", "PUT")
                and re.search(r"attach|upload|amazonaws", response.url, re.I)
                and 200 <= response.status < 300)
    async with page.expect_response(uploaded, timeout=30000) as pending:
        await page.locator("#power-attachments-file-upload-button").set_input_files(
            {"name": filename, "mimeType": "application/pdf", "buffer": pdf}
        )
    await (await pending.value).finished()
    await page.get_by_text(filename, exact=True).first.wait_for()
    return recipient
