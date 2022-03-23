const readline = require('readline');
const fsPromises = require('fs').promises;
const puppeteer = require('puppeteer');
const axios = require('axios').default;

const index_url = 'https://app.buaa.edu.cn/site/buaaStudentNcov/index';
const amap_host = 'webapi.amap.com';

function load_json(path) {
  return fsPromises.readFile(path, 'utf8')
    .then(JSON.parse);
}

function dump_json(path, data) {
  return fsPromises.writeFile(path, JSON.stringify(data, null, 2));
}

let cookie_cache;

async function get_cached_cookies(user) {
  if (!cookie_cache) {
    try {
      cookie_cache = await load_json('cookies.json');
    } catch (e) {
      cookie_cache = {};
      return undefined;
    }
  }
  return cookie_cache[user];
}

function save_cached_cookies(user, cookies) {
  cookie_cache[user] = cookies;
  return dump_json('cookies.json', cookie_cache);
}

function normalized_province(s) {
  return s[s.length - 1] === '省' ? s : s + '省';
}

async function get_ip_province() {
  const res = await axios.get('http://ip-api.com/json?lang=zh-CN');
  return normalized_prmovince(res.data.regionName);
}

async function make_pages(options, timeout = 3000) {
  // browser.pages() occasionally hangs in Termux PRoot context, trying for a second time seems to work
  while (true) {
    console.log('starting browser');
    const browser = await puppeteer.launch(options);
    console.log('getting pages');
    const pages = await Promise.race([
      browser.pages(),
      new Promise(resolve => setTimeout(() => resolve(null), timeout))
    ]);
    if (pages !== null)
      return [browser, pages];
    browser.close();
    timeout *= 2;
  }
}

class Daka {
  constructor({browser, page, config}) {
    this.browser = browser;
    this.page = page;
    this.config = config;
  }

  static async make(config) {
    let rt = await make_pages(config.browser);
    if (rt === null) {
      console.log('timed out, retrying');
      rt = await make_pages(config.browser, 5000);
      if (rt === null)
        throw new Error('browser timed out');
    }
    const [browser, pages] = rt;
    let page = pages[0];
    if (!page) {
      console.warn('creating a new page');
      page = await browser.newPage();
    }
    console.log('loading cookies');
    const {username} = config;
    const cookies = await get_cached_cookies(username);

    if (cookies)
      await page.setCookie(...cookies);
    else
      console.log(`no cookies cached for ${username}, logging in first`);

    return new Daka({browser, page, config});
  }

  async work() {
    const {page, config} = this;
    const {timeout} = config;
    if (timeout)
      page.setDefaultTimeout(timeout);

    const {longitude: lng, latitude: lat} = config;
    const loc_data = `({"info":"LOCATE_SUCCESS","status":1,"lng":"${lng}","lat":"${lat}"});`;

    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = req.url();
      if (url.includes('ipLocat')) {
        console.log('Overriding iploc');
        const p = url.indexOf('jsonp_');
        let q = url.indexOf('&', p);
        if (q < 0)
          q = url.length;
        req.respond({
          status: 200,
          headers: {'Allow-Control-Allow-Origin': '*'},
          body: url.substring(p, q) + loc_data
        });
      } else if (url.includes('save-geo-error')) {
        console.log('Blocking save-geo-error', url);
        req.abort();
      } else if (url.includes(amap_host)) {
        if (url.includes('/modules?') || url.includes('/maps?'))
          req.continue();
        else {
          console.log('Blocking amap api', url);
          req.abort();
        }
      } else
        req.continue();
    });

    function get_elem_text(elem) {
      return page.evaluate(e => e.innerText, elem);
    }

    console.log('navigating');
    await page.goto(index_url);
    console.log('waiting for page');
    await page.waitForFunction(() => {
      if (document.getElementsByClassName('pophint')[0]?.offsetParent)
        return false;
      if (document.getElementById('progress_loading')?.offsetParent)
        return false;
      const app = document.getElementById('app');
      if (app)
        return app;
      const dom = document.querySelector('.buaaStudentNcov-bg .sub-info');
      return dom?.offsetParent;
    });
    let dom = await page.$('.buaaStudentNcov-bg');
    if (!dom) {
      console.log('logging in');
      await page.waitForSelector('#app .btn', {visible: true});
      const app = await page.$('#app');
      const [username_input, password_input] = await app.$$('.content input');
      const btn = await app.$('.btn');
      const {username, password} = this.config;
      await username_input.type(username);
      await password_input.type(password);
      await btn.click();
      // await page.waitForNavigation();
      // Doing this hangs up sometimes, and using waitForSelector should be adequate
    }

    console.log('navigated')
    const geo = await page.waitForSelector(
      'div[name="szdd"] div[name="area"] .title-input input',
      {visible: true}
    );

    const submit = await page.$('div.sub-info');
    const status = await get_elem_text(submit);
    console.log('status', status);
    if (status.includes('已提交'))
      return {status};
    if (status.includes('未到'))
      throw new Error('status: ' + status);

    const expected_province_fut = config.disable_province_check ? undefined : get_ip_province();

    const addr_fut = new Promise((resolve, reject) => {
      page.on('response', async res => {
        const url = res.url();
        if (!url.includes('regeo'))
          return;
        const s = await res.text();
        const p = s.indexOf('(');
        const q = s.lastIndexOf(')');
        const data = JSON.parse(s.substring(p + 1, q));
        const expected_province = await expected_province_fut;
        if (expected_province !== undefined) {
          let {province} = data.regeocode.addressComponent;
          if (typeof province !== 'string')
            province = province[0];
          province = normalized_province(province);
          if (expected_province !== province)
            throw new Error(`mismatched province: ${province} (IP is from ${expected_province})`);
        }
        const addr = data.regeocode.formatted_address;
        if (addr) {
          console.log('regeo addr: ' + addr);
          resolve(addr);
        } else
          reject('bad regeo: ' + s);
      });
    });

    const {on_campus} = config;
    if (typeof on_campus === 'boolean') {
      const opts = await page.$$('div[name="sfzs"] .warp-list-choose > div');
      const opt = opts[on_campus ? 0 : 1];
      const text = await get_elem_text(opt);
      if (!text.startsWith(on_campus ? '是' : '否'))
        throw Error(`unexpected prompt text ${text} for on_campus ${on_campus}`);
      console.log('clicking ' + text);
      await opt.click();
    }

    await geo.click();

    await page.waitForSelector('.loadEffect', {visible: true});
    await page.waitForSelector('.loadEffect', {hidden: true});

    await addr_fut;
    await submit.click();

    const box = await Promise.race([
      page.waitForSelector('#wapcf', {visible: true}),
      page.waitForSelector('#wapat', {visible: true}),
    ]);
    if (await page.evaluate(e => e.id, box) === 'wapat') {
      const msg = await get_elem_text(await box.$('.wapat-title'));
      throw new Error('wapat: ' + msg);
    }
    const msg = await get_elem_text(await box.$('.wapcf-title'));
    console.log('message', msg);
    if (!msg.includes('每天只能填报一次'))
      throw new Error('message: ' + msg);

    const go = await box.$('.wapcf-btn-ok');

    if (config.dry)
      return {status: 'dry'};

    await go.click();

    const alert = await page.waitForSelector('div.alert', {visible: true});
    const res = await get_elem_text(alert);
    console.log('result', res);
    if (!res.includes('提交信息成功'))
      throw new Error('result: ' + res);
    return {status, message: msg, result: res, address: address[0]};
  }

  async drop() {
    const cookies = await this.page.cookies();
    await Promise.all([
      this.browser.close(),
      save_cached_cookies(this.config.username, cookies)
    ]);
  }
}

async function main() {
  const config = await load_json('config.json');
  const io = config.hang && readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  let s;
  try {
    s = await Daka.make(config);
  } catch (e) {
    console.error('Failed to create browser:', e)
    process.exit(1)
  }
  let err = false;
  try {
    const res = await s.work();
    console.log(JSON.stringify(res));
  } catch (e) {
    console.error('Worker failed:', e);
    err = true;
  } finally {
    if (io) {
      await new Promise(resolve => io.question('done\n', resolve));
      io.close();
    }
    await s.drop();
  }
  if (err)
    process.exit(1);
}

if (require.main === module) {
  main().catch(e => {
    console.error(e)
    process.exit(1)
  })
}
