# Existing deployments

## LAB ON TRACK — Exp. RIQAS / EQA (set up 2026-11-21)
- Notion page: https://app.notion.com/p/41e904df293c803395afc1fd1a32f93e (🧪 LAB ON TRACK : Smart Laboratory Quality Management)
- Source: database 📎 Project Schedule Calendar → data source **💭 Lab schedule calendar**
  - `CALENDAR_DATA_SOURCE` = `41e904df-293c-80b6-9483-000b1cfd3531`
  - Do not use the other data source `41e904df-293c-803b-8106-000be7a6e928` (แหล่งข้อมูลใหม่). It is an older copy.
  - Properties: title `Name`, date `วันที่`, category `หมวดหมู่` (RIQAS QC / EQA / Other), status `สถานะ`
- Settings table: ⚙️ ตั้งค่าแจ้งเตือน Exp. — https://app.notion.com/p/41f904df293c818e8db8d4cf1cd5a19c
  - `SETTINGS_DATA_SOURCE` = `41f904df-293c-8178-8e4a-000b477b2c28`
  - Rows: RIQAS QC → 3 days, EQA → 7 days, send at 7:00 (recipient email is in the table)
- Script: `apps-script/ExpiryAlert.gs` in repo naitarn/iqc-dashboard
