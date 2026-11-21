---
name: auto-alert
description: Set up or change automatic email reminders for dates in a Notion database (expiry dates, RIQAS, EQA, due dates, deadlines) using Google Apps Script, with settings kept in a Notion table so they can be changed from chat. Use when the user asks to set up date/expiry reminders by email from Notion ("แจ้งเตือน exp เข้าเมลล์", "ตั้งแจ้งเตือนล่วงหน้า"), or asks to change an existing reminder's lead days, recipients, send time, categories or on/off ("เปลี่ยน EQA เป็น 10 วัน", "เพิ่มผู้รับ", "ปิดแจ้งเตือน"), or says it isn't receiving the reminder emails.
---

# Auto-Alert — Notion → Email reminders (Apps Script)

The system has three parts:
1. **Source table** in Notion: the user's calendar/database with a title, a date and a category (select).
2. **Settings table** in Notion (`⚙️ ตั้งค่าแจ้งเตือน …`): one row per category with lead days, on/off, recipients and send hour. **All behaviour lives here**, so changes never need code.
3. **Apps Script** (`assets/ExpiryAlert.gs`), running hourly on Google's servers. It reads both tables and emails what is due. The user's computer and Notion do not need to be open.

Reply in the user's language (usually Thai). Check `references/deployments.md` first: if this table already has a deployment, you are in **Change mode**.

---

## Mode A: New setup

### A1. Ask the user first. Never assume these values.
Ask in one message (or with AskUserQuestion when available), offering what you found as defaults:
1. **Which Notion table/view?** Get a link if none was given.
2. **Which categories get reminders?** List the select options you found, e.g. RIQAS QC / EQA / Other.
3. **How many days before for each category?** Several values are allowed, e.g. `7, 3, 1`.
4. **Which email(s) receive them?** Read the address back to the user letter by letter. A swapped letter (nhschlab vs nhlabsch) has caused missed mail before.
5. **What time to send?** Hour 0–23. Default 7.
6. Optional: the name to show in the email (default: the Notion page title).

Do not build anything until the user has answered.

### A2. Inspect the source in Notion
- Fetch the link. If it is a **view** (`?v=`), fetch `view://<id>` and use its `dataSourceUrl`. A database can have **several data sources**, and the view tells you which one is the user's. Query one data source by its ID, never by the database ID.
- Note the exact property names for the title, the date, the category (select) and the status (optional).
- Run a quick SQL query to confirm that the categories and dates contain data.

### A3. Create the settings table
- Parent: a normal page, the top-level page that holds the calendar. Pages built from tabs or columns may reject databases ("Parent block type text cannot contain databases"). In that case use the ancestor page.
- Schema:
  `CREATE TABLE ("หมวดหมู่" TITLE, "แจ้งล่วงหน้า (วัน)" RICH_TEXT, "เปิดใช้งาน" CHECKBOX, "อีเมลผู้รับ" RICH_TEXT, "เวลาส่ง (โมง)" NUMBER, "ผลล่าสุด" RICH_TEXT)`
- Add one row per category with the user's answers. Set `ผลล่าสุด` = `ยังไม่ได้รัน`.

### A4. Produce the script
Copy `assets/ExpiryAlert.gs` and edit **only the `CONFIG` block**:
- `CALENDAR_DATA_SOURCE`: the source data source ID (UUID with dashes)
- `SETTINGS_DATA_SOURCE`: the new settings table's data source ID
- `CAL_TITLE`, `CAL_CATEGORY`, `CAL_DATE`, `CAL_STATUS`: the exact property names from A2
- `APP_NAME`, `CALENDAR_NAME`, `SETTINGS_NAME`, `TIMEZONE`

Save the script where the user can open it, e.g. `apps-script/<name>.gs` in the project or the scratchpad, and send it as a file. Do not put the Notion token or recipient emails in the code.

### A5. Give the install steps (the user does these; you cannot)
1. **Notion integration**: notion.so/profile/integrations → New integration → Internal, in the **same workspace**, with Read content + Update content. Then open the **Access** tab → Edit access → tick the page that holds both tables. If the integration "can't be found" in a page's ••• → Connections, it is in the wrong workspace or was not saved. Granting access from the Access tab avoids the search entirely. Creating integrations usually requires being a workspace owner.
2. **Apps Script**: script.google.com → New project → paste everything into **`Code.gs`** (not `appsscript.json`) → Save.
3. Project Settings: set Time zone to Bangkok (or the user's zone). Under Script properties, set **Property** to `NOTION_TOKEN` and **Value** to the `ntn_…` secret. Warn the user never to paste the secret into the chat.
4. Run `showSettings` (grant permissions) → `testSendPreview` → `setupTrigger`.
5. Emails are sent **from the Google account that owns the script**.

### A6. Record the deployment
Append the IDs, property names, recipients and the settings table URL to `references/deployments.md`, so that later chats land in Change mode.

---

## Mode B: Change an existing reminder from chat

1. Find the settings table: use `references/deployments.md`, or search Notion for `ตั้งค่าแจ้งเตือน`.
2. Read the current rows and show them briefly.
3. Map the request to a column:
   | User says | Column |
   |---|---|
   | "แจ้งล่วงหน้า N วัน", "7, 3, 1" | `แจ้งล่วงหน้า (วัน)` |
   | "เปลี่ยน/เพิ่ม/ลบอีเมล" | `อีเมลผู้รับ` (comma-separated) |
   | "ส่งกี่โมง" | `เวลาส่ง (โมง)` |
   | "ปิด/เปิด" | `เปิดใช้งาน` |
   | "เพิ่มหมวด X" | add a row. The title must match the select option in the source exactly |
4. If the request is ambiguous (which category? replace or add an email?), **ask before you edit**. Repeat any new email address back to the user.
5. Update the row(s). Then tell the user what changed and that it takes effect at the next hourly run. Raising the lead days makes items that now fall inside the window send at the next run. Items that were already sent are not sent again.
6. No code changes or redeploys are needed for any of these.

---

## Troubleshooting ("ไม่ได้รับเมลล์")
1. Read the settings rows. Check the **email spelling** and `เปิดใช้งาน`, and confirm that `เวลาส่ง` has passed.
2. `ผลล่าสุด`:
   - `ยังไม่ได้รัน`: the hourly job has never finished. The user should run `testSendPreview`, check ⏰ Triggers for `checkExpiryAndNotify` (Hour timer), and look under **Executions** for Failed runs.
   - `✔️ … ไม่มีรายการ`: the job works and nothing is due yet. Compare the lead days with the calendar dates.
   - `✅ … ส่ง N รายการ`: the mail was sent. Check Spam/Updates and the recipient address.
3. `Notion API 401/404`: the token is wrong, or the integration has no access to the page (Access tab).
4. If the user wants proof that the address receives mail and a Gmail connector is available, you may send **one** clearly labelled test email after they ask. Say that it came from the connector, not from the script.

## Script behaviour (for answering questions)
- Runs hourly. A category sends once the current hour ≥ `เวลาส่ง`.
- For each item and each lead value: it sends when 0 ≤ days left ≤ lead and has not sent for that lead yet. The log of sent items is kept in Script Properties `SENT_LOG` and pruned after the date passes. `resetSentHistory` clears it.
- One email per recipient group per run, grouped by category.
- It writes `ผลล่าสุด` once a day, or whenever it sends.
- It uses Notion API version `2025-09-03` and `/v1/data_sources/{id}/query`.
