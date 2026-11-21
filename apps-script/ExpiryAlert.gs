/**
 * LAB ON TRACK — แจ้งเตือนวัน Exp. RIQAS / EQA ทางอีเมลอัตโนมัติ
 *
 * อ่านข้อมูลจาก Notion database "Project Schedule Calendar" (หน้า 📅 Calendar)
 * แล้วส่งอีเมลเมื่อใกล้ถึงวันที่ในคอลัมน์ "วันที่":
 *   - หมวดหมู่ "RIQAS QC" → แจ้งเตือนล่วงหน้า 3 วัน
 *   - หมวดหมู่ "EQA"      → แจ้งเตือนล่วงหน้า 7 วัน
 *
 * ทำงานบนเซิร์ฟเวอร์ Google ตามเวลาที่ตั้ง (time-driven trigger)
 * ไม่ต้องเปิดคอมพิวเตอร์หรือเปิดหน้า Notion
 *
 * ต้องตั้ง Script Properties (Project Settings → Script properties):
 *   NOTION_TOKEN  = Internal Integration Secret จาก Notion (ขึ้นต้นด้วย ntn_ หรือ secret_)
 *   ALERT_EMAIL   = อีเมลผู้รับ (คั่นหลายอีเมลด้วย ,)
 *
 * วิธีติดตั้งดูใน apps-script/README.md
 */

const CONFIG = {
  // Notion database "Project Schedule Calendar"
  DATABASE_ID: '41e904df293c8059881fff46fc209c2a',
  NOTION_VERSION: '2022-06-28',
  TIMEZONE: 'Asia/Bangkok',
  SEND_HOUR: 7, // ส่งอีเมลประมาณ 07:00–08:00 น. ทุกวัน

  PROP_TITLE: 'Name',
  PROP_CATEGORY: 'หมวดหมู่',
  PROP_DATE: 'วันที่',
  PROP_DATE_FALLBACK: 'Date',
  PROP_STATUS: 'สถานะ',

  // จำนวนวันที่แจ้งล่วงหน้า แยกตามหมวดหมู่
  RULES: {
    'RIQAS QC': 3,
    'EQA': 7,
  },
};

/** ฟังก์ชันหลัก — trigger เรียกทุกวัน */
function checkExpiryAndNotify() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('NOTION_TOKEN');
  const email = props.getProperty('ALERT_EMAIL');
  if (!token || !email) {
    throw new Error('ยังไม่ได้ตั้ง Script Properties: NOTION_TOKEN และ ALERT_EMAIL');
  }

  const today = todayStr_();
  const maxDays = Math.max.apply(null, Object.values(CONFIG.RULES));
  const items = queryUpcoming_(token, today, addDays_(today, maxDays));

  const sent = loadSent_();
  const due = [];
  items.forEach(function (it) {
    const lead = CONFIG.RULES[it.category];
    if (lead === undefined) return;
    const daysLeft = diffDays_(today, it.date);
    // แจ้งเมื่อเหลือ <= lead วัน และยังไม่เคยแจ้งรายการนี้ (กันแจ้งซ้ำ และตามแจ้งรายการที่เพิ่มทีหลัง)
    if (daysLeft < 0 || daysLeft > lead) return;
    const key = it.id + '|' + it.date;
    if (sent[key]) return;
    it.daysLeft = daysLeft;
    it.key = key;
    due.push(it);
  });

  if (due.length === 0) {
    Logger.log('ไม่มีรายการที่ต้องแจ้งวันนี้ (' + today + ')');
    pruneSent_(sent, today);
    saveSent_(sent);
    return;
  }

  due.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  sendEmail_(email, due, today);

  due.forEach(function (it) { sent[it.key] = today; });
  pruneSent_(sent, today);
  saveSent_(sent);
  Logger.log('ส่งแจ้งเตือน ' + due.length + ' รายการไปที่ ' + email);
}

/** รันครั้งเดียวเพื่อสร้าง trigger รายวัน (ลบ trigger เดิมของฟังก์ชันนี้ก่อน) */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkExpiryAndNotify') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkExpiryAndNotify')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.SEND_HOUR)
    .inTimezone(CONFIG.TIMEZONE)
    .create();
  Logger.log('ตั้ง trigger รายวันเวลา ~' + CONFIG.SEND_HOUR + ':00 น. (' + CONFIG.TIMEZONE + ') แล้ว');
}

/** ทดสอบ: ส่งอีเมลรายการ RIQAS/EQA ทั้งหมดใน 30 วันข้างหน้า (ไม่บันทึกว่าแจ้งแล้ว) */
function testSendPreview() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('NOTION_TOKEN');
  const email = props.getProperty('ALERT_EMAIL');
  const today = todayStr_();
  const items = queryUpcoming_(token, today, addDays_(today, 30))
    .filter(function (it) { return CONFIG.RULES[it.category] !== undefined; })
    .map(function (it) { it.daysLeft = diffDays_(today, it.date); return it; });
  if (items.length === 0) { Logger.log('ไม่พบรายการใน 30 วันข้างหน้า'); return; }
  sendEmail_(email, items, today, '[ทดสอบ] ');
  Logger.log('ส่งอีเมลทดสอบ ' + items.length + ' รายการแล้ว');
}

/** ล้างประวัติการแจ้งเตือน (ถ้าต้องการให้แจ้งซ้ำ) */
function resetSentHistory() {
  PropertiesService.getScriptProperties().deleteProperty('SENT_LOG');
  Logger.log('ล้างประวัติการแจ้งเตือนแล้ว');
}

// ---------------------------------------------------------------- Notion

function queryUpcoming_(token, fromDate, toDate) {
  const url = 'https://api.notion.com/v1/databases/' + CONFIG.DATABASE_ID + '/query';
  const categoryFilter = Object.keys(CONFIG.RULES).map(function (name) {
    return { property: CONFIG.PROP_CATEGORY, select: { equals: name } };
  });
  const body = {
    filter: {
      and: [
        { or: categoryFilter },
        { property: CONFIG.PROP_DATE, date: { on_or_after: fromDate } },
        { property: CONFIG.PROP_DATE, date: { on_or_before: toDate } },
      ],
    },
    sorts: [{ property: CONFIG.PROP_DATE, direction: 'ascending' }],
    page_size: 100,
  };

  const out = [];
  let cursor = null;
  do {
    if (cursor) body.start_cursor = cursor; else delete body.start_cursor;
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        'Notion-Version': CONFIG.NOTION_VERSION,
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const json = JSON.parse(res.getContentText());
    if (code !== 200) {
      throw new Error('Notion API ' + code + ': ' + (json.message || res.getContentText()) +
        '\n(ตรวจว่าแชร์ database ให้ integration แล้ว: ••• → Connections → เพิ่ม integration)');
    }
    json.results.forEach(function (page) {
      const p = page.properties;
      const date = dateOf_(p[CONFIG.PROP_DATE]) || dateOf_(p[CONFIG.PROP_DATE_FALLBACK]);
      if (!date) return;
      out.push({
        id: page.id,
        url: page.url,
        title: titleOf_(p[CONFIG.PROP_TITLE]),
        category: p[CONFIG.PROP_CATEGORY] && p[CONFIG.PROP_CATEGORY].select
          ? p[CONFIG.PROP_CATEGORY].select.name : '',
        status: p[CONFIG.PROP_STATUS] && p[CONFIG.PROP_STATUS].select
          ? p[CONFIG.PROP_STATUS].select.name : '',
        date: date,
      });
    });
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return out;
}

function titleOf_(prop) {
  if (!prop || !prop.title) return '(ไม่มีชื่อ)';
  return prop.title.map(function (t) { return t.plain_text; }).join('') || '(ไม่มีชื่อ)';
}

function dateOf_(prop) {
  if (!prop || !prop.date || !prop.date.start) return null;
  return prop.date.start.substring(0, 10); // YYYY-MM-DD
}

// ---------------------------------------------------------------- Email

function sendEmail_(email, items, today, prefix) {
  const riqas = items.filter(function (i) { return i.category === 'RIQAS QC'; });
  const eqa = items.filter(function (i) { return i.category === 'EQA'; });

  const parts = [];
  if (riqas.length) parts.push('RIQAS ' + riqas.length);
  if (eqa.length) parts.push('EQA ' + eqa.length);
  const subject = (prefix || '') + '⚠️ แจ้งเตือนใกล้ถึงกำหนด: ' + parts.join(', ') +
    ' รายการ (' + thaiDate_(today) + ')';

  const html =
    '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#1f2937">' +
    '<h2 style="color:#0e7490;margin:0 0 8px">LAB ON TRACK — แจ้งเตือนวันครบกำหนด</h2>' +
    '<p style="margin:0 0 16px">ข้อมูล ณ วันที่ ' + thaiDate_(today) + '</p>' +
    section_('RIQAS QC (แจ้งล่วงหน้า ' + CONFIG.RULES['RIQAS QC'] + ' วัน)', riqas) +
    section_('EQA (แจ้งล่วงหน้า ' + CONFIG.RULES['EQA'] + ' วัน)', eqa) +
    '<p style="color:#6b7280;font-size:12px;margin-top:24px">อีเมลนี้ส่งอัตโนมัติจาก Google Apps Script ' +
    'โดยอ่านข้อมูลจาก Notion › Calendar</p></div>';

  const text = items.map(function (i) {
    return '- [' + i.category + '] ' + i.title + ' — ' + thaiDate_(i.date) + ' (' + daysText_(i.daysLeft) + ')';
  }).join('\n');

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: 'แจ้งเตือนวันครบกำหนด\n\n' + text,
    htmlBody: html,
    name: 'LAB ON TRACK',
  });
}

function section_(heading, list) {
  if (!list.length) return '';
  const rows = list.map(function (i) {
    const color = i.daysLeft <= 1 ? '#b91c1c' : '#b45309';
    return '<tr>' +
      td_('<a href="' + i.url + '" style="color:#0e7490;text-decoration:none">' + esc_(i.title) + '</a>') +
      td_(thaiDate_(i.date)) +
      td_('<b style="color:' + color + '">' + daysText_(i.daysLeft) + '</b>') +
      td_(esc_(i.status || '-')) +
      '</tr>';
  }).join('');
  return '<h3 style="margin:16px 0 6px">' + esc_(heading) + '</h3>' +
    '<table style="border-collapse:collapse;width:100%;max-width:640px">' +
    '<tr style="background:#ecfeff">' + th_('รายการ') + th_('วันที่') + th_('เหลือ') + th_('สถานะ') + '</tr>' +
    rows + '</table>';
}

function th_(s) { return '<th style="text-align:left;padding:6px 8px;border:1px solid #d1e3e8">' + s + '</th>'; }
function td_(s) { return '<td style="padding:6px 8px;border:1px solid #d1e3e8">' + s + '</td>'; }
function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function daysText_(n) { return n === 0 ? 'วันนี้' : n === 1 ? 'พรุ่งนี้' : 'อีก ' + n + ' วัน'; }

// ---------------------------------------------------------------- Dates

function todayStr_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function parseYmd_(s) {
  const p = s.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

function addDays_(ymd, n) {
  const d = new Date(parseYmd_(ymd) + n * 86400000);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function diffDays_(fromYmd, toYmd) {
  return Math.round((parseYmd_(toYmd) - parseYmd_(fromYmd)) / 86400000);
}

function thaiDate_(ymd) {
  const m = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const p = ymd.split('-').map(Number);
  return p[2] + ' ' + m[p[1] - 1] + ' ' + (p[0] + 543);
}

// ---------------------------------------------------------------- Sent log

function loadSent_() {
  const raw = PropertiesService.getScriptProperties().getProperty('SENT_LOG');
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

function saveSent_(sent) {
  PropertiesService.getScriptProperties().setProperty('SENT_LOG', JSON.stringify(sent));
}

/** ลบประวัติของรายการที่เลยวันครบกำหนดไปแล้ว เพื่อไม่ให้ข้อมูลโตเรื่อย ๆ */
function pruneSent_(sent, today) {
  Object.keys(sent).forEach(function (k) {
    const date = k.split('|')[1];
    if (!date || date < today) delete sent[k];
  });
}
