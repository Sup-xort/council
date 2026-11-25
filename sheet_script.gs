// 학생회 구글 계정의 Apps Script 에 붙여 넣는 코드. council.py 의 sheet_post 가 행사의 신청 전체를 보낸다.
// 행사마다 'SWITCH 행사 신청' 폴더에 시트를 하나 만들고(처음 한 번), 받을 때마다 내용을 통째로 바꿔 쓴다.
// SECRET 은 서버 council.env 의 COUNCIL_SHEET_SECRET 과 같아야 한다.
const SECRET = '여기에_비밀값';
const FOLDER = 'SWITCH 행사 신청';

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({error: 'bad request'});
  }
  if (req.secret !== SECRET) return out({error: 'secret'});
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = sheetFor(req.key, req.title);
    if (ss.getName() !== req.title) ss.rename(req.title);
    const sh = ss.getSheets()[0];
    sh.clear();
    const rows = req.rows || [];
    if (rows.length) {
      const range = sh.getRange(1, 1, rows.length, rows[0].length);
      range.setNumberFormat('@');
      range.setRichTextValues(rows.map(r => r.map(v => SpreadsheetApp.newRichTextValue().setText(String(v)).build())));
      sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    const formulas = rows.length ? sh.getRange(1, 1, rows.length, rows[0].length).getFormulas().flat().filter(String).length : 0;
    return out({ok: true, url: ss.getUrl(), formulas: formulas});
  } catch (err) {
    return out({error: String(err).slice(0, 200)});
  } finally {
    lock.releaseLock();
  }
}

function sheetFor(key, title) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('sheet_' + key);
  if (id) {
    try {
      if (!DriveApp.getFileById(id).isTrashed()) return SpreadsheetApp.openById(id);
    } catch (err) {}
  }
  const ss = SpreadsheetApp.create(title);
  DriveApp.getFileById(ss.getId()).moveTo(folder(props));
  props.setProperty('sheet_' + key, ss.getId());
  return ss;
}

function folder(props) {
  const id = props.getProperty('folder');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) {}
  }
  const f = DriveApp.createFolder(FOLDER);
  props.setProperty('folder', f.getId());
  return f;
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
