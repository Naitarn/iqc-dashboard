/**
 * LAB ON TRACK — แจ้งเตือนวัน Exp. RIQAS / EQA ทางอีเมลอัตโนมัติ
 *
 * อ่านข้อมูล 2 ตารางใน Notion:
 *   1) ปฏิทิน "💭 Lab schedule calendar" (คอลัมน์ Name / หมวดหมู่ / วันที่ / สถานะ)
 *   2) "⚙️ ตั้งค่าแจ้งเตือน Exp." — กำหนดว่าแต่ละหมวดหมู่แจ้งล่วงหน้ากี่วัน ส่งถึงใคร กี่โมง
 *
 * การตั้งค่าทั้งหมดอยู่ในตารางที่ 2 จึงแก้ได้จาก Notion โดยตรง หรือบอก Claude ในแชตให้แก้
 * โดยไม่ต้องแก้โค้ดนี้ สคริปต์ทำงานทุกชั่วโมงบนเซิร์ฟเวอร์ Google (ไม่ต้องเปิดคอม/Notion)
 * ค่าที่แก้ใน Notion จะมีผลในรอบถัดไป (ภายใน ~1 ชั่วโมง)
 *
 * Script Properties ที่ต้องตั้ง (Project Settings → Script properties):
 *   NOTION_TOKEN  = Internal Integration Secret จาก Notion (ntn_...)
 *
 * วิธีติดตั้งดูใน apps-script/README.md
 */

const CONFIG = {
  CALENDAR_DATA_SOURCE: '41e904df-293c-80b6-9483-000b1cfd3531', // 💭 Lab schedule calendar
  SETTINGS_DATA_SOURCE: '41f904df-293c-8178-8e4a-000b477b2c28', // ⚙️ ตั้งค่าแจ้งเตือน Exp.
  NOTION_VERSION: '2025-09-03',
  TIMEZONE: 'Asia/Bangkok',

  // ชื่อคอลัมน์ในปฏิทิน
  CAL_TITLE: 'Name',
  CAL_CATEGORY: 'หมวดหมู่',
  CAL_DATE: 'วันที่',
  CAL_STATUS: 'สถานะ',

  // ชื่อคอลัมน์ในตารางตั้งค่า
  SET_CATEGORY: 'หมวดหมู่',
  SET_LEADS: 'แจ้งล่วงหน้า (วัน)',
  SET_ENABLED: 'เปิดใช้งาน',
  SET_EMAIL: 'อีเมลผู้รับ',
  SET_HOUR: 'เวลาส่ง (โมง)',
  SET_RESULT: 'ผลล่าสุด',

  DEFAULT_HOUR: 7,
};

// ================================================================ ฟังก์ชันที่ใช้งาน

/** ฟังก์ชันหลัก — trigger เรียกทุกชั่วโมง */
function checkExpiryAndNotify() {
  const token = getToken_();
  const now = new Date();
  const today = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'H'));

  const settings = loadSettings_(token).filter(function (s) { return s.enabled && s.leads.length; });
  if (!settings.length) { Logger.log('ไม่มีหมวดหมู่ที่เปิดใช้งาน'); return; }

  // หมวดที่ถึงเวลาส่งของวันนี้แล้ว
  const active = settings.filter(function (s) { return hour >= s.hour; });
  if (!active.length) { Logger.log('ยังไม่ถึงเวลาส่ง (ตอนนี้ ' + hour + ' โมง)'); return; }

  const byCat = {};
  active.forEach(function (s) { byCat[s.category] = s; });
  const maxLead = Math.max.apply(null, active.map(function (s) { return s.leads[0]; }));
  const items = queryCalendar_(token, Object.keys(byCat), today, addDays_(today, maxLead));

  const sent = loadSent_();
  const due = [];
  items.forEach(function (it) {
    const s = byCat[it.category];
    if (!s) return;
    const daysLeft = diffDays_(today, it.date);
    // แจ้งเมื่อเหลือ <= จำนวนวันที่ตั้ง และยังไม่เคยแจ้งในรอบนั้น
    const keys = s.leads
      .filter(function (lead) { return daysLeft >= 0 && daysLeft <= lead; })
      .map(function (lead) { return it.id + '|' + it.date + '|' + lead; })
      .filter(function (k) { return !sent[k]; });
    if (!keys.length) return;
    it.daysLeft = daysLeft;
    it.keys = keys;
    it.setting = s;
    due.push(it);
  });

  // จัดกลุ่มตามผู้รับ แล้วส่งอีเมลฉบับเดียวต่อกลุ่ม
  const groups = {};
  due.forEach(function (it) {
    const to = it.setting.email;
    (groups[to] = groups[to] || []).push(it);
  });
  const sentCount = {};
  Object.keys(groups).forEach(function (to) {
    if (!to) { Logger.log('ข้าม: หมวดที่ไม่มีอีเมลผู้รับ'); return; }
    const list = groups[to].sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    sendEmail_(to, list, today, '');
    list.forEach(function (it) {
      it.keys.forEach(function (k) { sent[k] = today; });
      sentCount[it.category] = (sentCount[it.category] || 0) + 1;
    });
  });

  pruneSent_(sent, today);
  saveSent_(sent);

  // เขียนผลลงคอลัมน์ "ผลล่าสุด" ใน Notion (วันละครั้ง หรือเมื่อมีการส่ง)
  const stamp = Utilities.formatDate(now, CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm');
  const props = PropertiesService.getScriptProperties();
  active.forEach(function (s) {
    const n = sentCount[s.category] || 0;
    const reportKey = 'REPORTED_' + s.pageId;
    if (n === 0 && props.getProperty(reportKey) === today) return;
    const msg = n > 0
      ? '✅ ' + stamp + ' ส่งแจ้งเตือน ' + n + ' รายการ'
      : '✔️ ' + stamp + ' ตรวจแล้ว ไม่มีรายการที่ต้องแจ้ง (แจ้งล่วงหน้า ' + s.leads.join(', ') + ' วัน)';
    writeResult_(token, s.pageId, msg);
    props.setProperty(reportKey, today);
  });

  Logger.log('ส่งแล้ว: ' + JSON.stringify(sentCount));
}

/** รันครั้งเดียวเพื่อสร้าง trigger ทุกชั่วโมง */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkExpiryAndNotify') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkExpiryAndNotify').timeBased().everyHours(1).create();
  Logger.log('ตั้ง trigger ทุกชั่วโมงแล้ว');
}

/** ดูค่าที่อ่านได้จากตารางตั้งค่า (ใช้ตรวจว่าเชื่อม Notion สำเร็จ) */
function showSettings() {
  loadSettings_(getToken_()).forEach(function (s) {
    Logger.log(s.category + ' | เปิด=' + s.enabled + ' | แจ้งล่วงหน้า ' + s.leads.join(', ') +
      ' วัน | ส่ง ' + s.hour + ':00 | ถึง ' + s.email);
  });
}

/** ทดสอบ: ส่งอีเมลรายการทุกหมวดที่เปิดใช้งาน ใน 30 วันข้างหน้า (ไม่บันทึกว่าแจ้งแล้ว) */
function testSendPreview() {
  const token = getToken_();
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const settings = loadSettings_(token).filter(function (s) { return s.enabled; });
  const byCat = {};
  settings.forEach(function (s) { byCat[s.category] = s; });
  const items = queryCalendar_(token, Object.keys(byCat), today, addDays_(today, 30));
  const groups = {};
  items.forEach(function (it) {
    it.daysLeft = diffDays_(today, it.date);
    it.setting = byCat[it.category];
    const to = it.setting.email;
    (groups[to] = groups[to] || []).push(it);
  });
  Object.keys(groups).forEach(function (to) {
    if (to) sendEmail_(to, groups[to], today, '[ทดสอบ] ');
  });
  Logger.log('ส่งอีเมลทดสอบ ' + items.length + ' รายการแล้ว');
}

/** ล้างประวัติการแจ้งเตือน (ถ้าต้องการให้แจ้งรายการเดิมซ้ำ) */
function resetSentHistory() {
  PropertiesService.getScriptProperties().deleteProperty('SENT_LOG');
  Logger.log('ล้างประวัติการแจ้งเตือนแล้ว');
}

// ================================================================ Notion

function getToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้ง Script Property: NOTION_TOKEN');
  return token;
}

function notion_(token, method, path, body) {
  const res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, 'Notion-Version': CONFIG.NOTION_VERSION },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const json = JSON.parse(res.getContentText());
  if (code !== 200) {
    throw new Error('Notion API ' + code + ': ' + (json.message || res.getContentText()) +
      '\n(ตรวจว่าเพิ่ม integration ที่หน้า LAB ON TRACK แล้ว: ••• → Connections)');
  }
  return json;
}

function queryAll_(token, dataSourceId, body) {
  const out = [];
  let cursor = null;
  do {
    const b = Object.assign({ page_size: 100 }, body);
    if (cursor) b.start_cursor = cursor;
    const json = notion_(token, 'post', '/data_sources/' + dataSourceId + '/query', b);
    Array.prototype.push.apply(out, json.results);
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return out;
}

function loadSettings_(token) {
  return queryAll_(token, CONFIG.SETTINGS_DATA_SOURCE, {}).map(function (page) {
    const p = page.properties;
    const leads = (text_(p[CONFIG.SET_LEADS]).match(/\d+/g) || [])
      .map(Number)
      .filter(function (n, i, a) { return a.indexOf(n) === i; })
      .sort(function (a, b) { return b - a; }); // มาก → น้อย
    const hourVal = p[CONFIG.SET_HOUR] && p[CONFIG.SET_HOUR].number;
    return {
      pageId: page.id,
      category: text_(p[CONFIG.SET_CATEGORY]).trim(),
      leads: leads,
      enabled: !!(p[CONFIG.SET_ENABLED] && p[CONFIG.SET_ENABLED].checkbox),
      email: text_(p[CONFIG.SET_EMAIL]).replace(/\s+/g, ''),
      hour: typeof hourVal === 'number' ? Math.min(23, Math.max(0, Math.floor(hourVal))) : CONFIG.DEFAULT_HOUR,
    };
  }).filter(function (s) { return s.category; });
}

function queryCalendar_(token, categories, fromDate, toDate) {
  if (!categories.length) return [];
  const pages = queryAll_(token, CONFIG.CALENDAR_DATA_SOURCE, {
    filter: {
      and: [
        { or: categories.map(function (c) { return { property: CONFIG.CAL_CATEGORY, select: { equals: c } }; }) },
        { property: CONFIG.CAL_DATE, date: { on_or_after: fromDate } },
        { property: CONFIG.CAL_DATE, date: { on_or_before: toDate } },
      ],
    },
    sorts: [{ property: CONFIG.CAL_DATE, direction: 'ascending' }],
  });
  return pages.map(function (page) {
    const p = page.properties;
    const d = p[CONFIG.CAL_DATE] && p[CONFIG.CAL_DATE].date;
    return {
      id: page.id,
      url: page.url,
      title: text_(p[CONFIG.CAL_TITLE]) || '(ไม่มีชื่อ)',
      category: sel_(p[CONFIG.CAL_CATEGORY]),
      status: sel_(p[CONFIG.CAL_STATUS]),
      date: d && d.start ? d.start.substring(0, 10) : null,
    };
  }).filter(function (it) { return it.date; });
}

function writeResult_(token, pageId, msg) {
  try {
    const props = {};
    props[CONFIG.SET_RESULT] = { rich_text: [{ text: { content: msg } }] };
    notion_(token, 'patch', '/pages/' + pageId, { properties: props });
  } catch (e) {
    // integration อาจไม่มีสิทธิ์ Update content — ไม่กระทบการส่งอีเมล
    Logger.log('เขียนผลลง Notion ไม่ได้: ' + e.message);
  }
}

function text_(prop) {
  if (!prop) return '';
  const arr = prop.title || prop.rich_text || [];
  return arr.map(function (t) { return t.plain_text; }).join('');
}

function sel_(prop) {
  return prop && prop.select ? prop.select.name : '';
}

// ================================================================ Email

function sendEmail_(to, items, today, prefix) {
  const cats = [];
  items.forEach(function (i) { if (cats.indexOf(i.category) < 0) cats.push(i.category); });
  const counts = cats.map(function (c) {
    return c + ' ' + items.filter(function (i) { return i.category === c; }).length;
  });
  const subject = prefix + '⚠️ แจ้งเตือนใกล้ถึงกำหนด: ' + counts.join(', ') + ' รายการ (' + thaiDate_(today) + ')';

  const sections = cats.map(function (c) {
    const list = items.filter(function (i) { return i.category === c; });
    return section_(c + ' (แจ้งล่วงหน้า ' + list[0].setting.leads.join(', ') + ' วัน)', list);
  }).join('');

  const html =
    '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#1f2937">' +
    '<h2 style="color:#0e7490;margin:0 0 8px">LAB ON TRACK — แจ้งเตือนวันครบกำหนด</h2>' +
    '<p style="margin:0 0 16px">ข้อมูล ณ วันที่ ' + thaiDate_(today) + '</p>' + sections +
    '<p style="color:#6b7280;font-size:12px;margin-top:24px">ส่งอัตโนมัติจาก Google Apps Script ' +
    'โดยอ่านข้อมูลจาก Notion › Lab schedule calendar · ปรับจำนวนวันได้ที่ตาราง ⚙️ ตั้งค่าแจ้งเตือน Exp.</p></div>';

  const text = items.map(function (i) {
    return '- [' + i.category + '] ' + i.title + ' — ' + thaiDate_(i.date) + ' (' + daysText_(i.daysLeft) + ')';
  }).join('\n');

  MailApp.sendEmail({ to: to, subject: subject, body: 'แจ้งเตือนวันครบกำหนด\n\n' + text, htmlBody: html, name: 'LAB ON TRACK' });
}

function section_(heading, list) {
  const rows = list.map(function (i) {
    const color = i.daysLeft <= 1 ? '#b91c1c' : '#b45309';
    return '<tr>' +
      td_('<a href="' + i.url + '" style="color:#0e7490;text-decoration:none">' + esc_(i.title) + '</a>') +
      td_(thaiDate_(i.date)) +
      td_('<b style="color:' + color + '">' + daysText_(i.daysLeft) + '</b>') +
      td_(esc_(i.status || '-')) + '</tr>';
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

// ================================================================ Dates

function parseYmd_(s) {
  const p = s.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}
function addDays_(ymd, n) {
  return new Date(parseYmd_(ymd) + n * 86400000).toISOString().substring(0, 10);
}
function diffDays_(fromYmd, toYmd) {
  return Math.round((parseYmd_(toYmd) - parseYmd_(fromYmd)) / 86400000);
}
function thaiDate_(ymd) {
  const m = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const p = ymd.split('-').map(Number);
  return p[2] + ' ' + m[p[1] - 1] + ' ' + (p[0] + 543);
}

// ================================================================ Sent log

function loadSent_() {
  const raw = PropertiesService.getScriptProperties().getProperty('SENT_LOG');
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
function saveSent_(sent) {
  PropertiesService.getScriptProperties().setProperty('SENT_LOG', JSON.stringify(sent));
}
/** ลบประวัติของรายการที่เลยวันครบกำหนดไปแล้ว */
function pruneSent_(sent, today) {
  Object.keys(sent).forEach(function (k) {
    const date = k.split('|')[1];
    if (!date || date < today) delete sent[k];
  });
}
