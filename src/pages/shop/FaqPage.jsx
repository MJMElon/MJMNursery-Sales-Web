import React from 'react';
import { css } from './css.js';

// FAQ PAGE — frequently-asked questions page, linked from the About MJM
// nav dropdown. A table of contents at the top jumps to each answer below.
// Content is bilingual (English + Chinese) and hard-coded here so it renders
// without any data fetch.

const cardStyle = 'background:#fff;border-radius:16px;padding:2rem 2.5rem;border:1px solid rgba(0,0,0,.06);line-height:1.8;color:var(--text-mid);font-size:14px;';
const tocCardStyle = 'background:#fff;border-radius:16px;padding:1.75rem 2rem;border:1px solid rgba(0,0,0,.06);';
const sectionHeadingStyle = 'color:var(--text-dark);font-size:17px;font-weight:600;margin:2rem 0 .75rem;padding-bottom:.4rem;border-bottom:2px solid var(--green-pale);';
const sectionHeadingFirstStyle = sectionHeadingStyle.replace('margin:2rem 0 .75rem', 'margin:0 0 .75rem');
const tocLinkStyle = 'display:block;padding:.4rem .2rem;color:var(--text-mid);font-size:13.5px;line-height:1.55;text-decoration:none;cursor:pointer;border-bottom:1px dashed rgba(0,0,0,.06);transition:color .15s,background .15s;';
const qHeadingStyle = 'color:var(--text-dark);font-size:14.5px;font-weight:600;margin:0 0 .6rem;';
const qAnchorOffset = 'scroll-margin-top:170px;border-radius:10px;padding-left:.5rem;padding-right:.5rem;margin-left:-.5rem;margin-right:-.5rem;';
const answerEnStyle = 'margin:0 0 .75rem;';
const answerZhStyle = 'margin:0;color:var(--text-mid);';

const SECTIONS = [
  {
    id: 'sec-varieties',
    title: '1. 种苗品种与品质 · Seedling Varieties & Quality',
    items: [
      {
        id: 'q1',
        q: 'Q1. IOI、UPB 和 AAR 有什么区别？ / What is the difference between IOI, UPB and AAR?',
        en: 'All IOI, UPB and AAR seedlings are certified DxP oil palm seedlings. They differ mainly in their genetic background and breeding programmes, which may influence yield potential, bunch characteristics, oil production and palm growth. Each has its own strengths, and actual performance also depends on planting conditions and management.',
        zh: 'IOI、UPB 和 AAR 都是经过认证的 DxP 油棕苗。它们主要的区别在于遗传来源及育种计划，这可能影响产量潜力、果串特性、油产量及植株生长。每个品种都有其特点，实际表现也会受到种植环境及管理方式的影响。',
      },
      {
        id: 'q2',
        q: 'Q2. 哪一个品种比较好？ / Which variety is better?',
        en: 'All three are established DxP planting materials. We would not recommend judging a variety solely by its brand name, as actual performance depends on soil conditions, planting practices and estate management. The choice depends on your planting requirements and preferences.',
        zh: '这三个都是成熟的 DxP 种植材料。我们不建议单凭品牌名称来判断哪一个最好，因为实际表现还取决于土壤条件、种植方式及园地管理。选择哪一个主要取决于您的种植需求及偏好。',
      },
      {
        id: 'q3',
        q: 'Q3. 你们的苗是 Certified Seedlings 吗？ / Are your seedlings certified?',
        en: 'Yes, we supply certified DxP oil palm seedlings sourced from MPOB-licensed seed producers, recognised by the Malaysian Palm Oil Board (MPOB).',
        zh: '是的，我们供应认证的 DxP 油棕苗，种苗来源于获得马来西亚棕油局（MPOB）许可的种苗供应商。',
      },
      {
        id: 'q4',
        q: 'Q4. DxP 是什么意思？ / What does DxP mean?',
        en: 'DxP stands for Dura × Pisifera, a hybrid cross used to produce commercial oil palm planting materials.',
        zh: 'DxP 是 Dura × Pisifera 的杂交组合，是商业油棕种苗常见的育种类型。',
      },
      {
        id: 'q5',
        q: 'Q5. 你们的 Matured Seedlings 是几个月？ / How old are your matured seedlings?',
        en: 'Our matured oil palm seedlings are generally around 10–12 months old or above, depending on the available stock.',
        zh: '我们的成熟油棕苗一般为 10–12 个月或以上，具体苗龄视现有库存而定。',
      },
      {
        id: 'q6',
        q: 'Q6. 你们的苗有多高？ / How tall are your seedlings?',
        en: 'Our matured oil palm seedlings are generally 150 cm and above in height, depending on the variety and available stock.',
        zh: '我们的成熟油棕苗一般高度为 150 cm 及以上，具体高度视品种及现有库存而定。',
      },
      {
        id: 'q7',
        q: 'Q7. 苗的大小一样吗？ / Are all seedlings the same size?',
        en: 'Seedlings may vary slightly in height, leaf development and overall appearance. This is normal, as seedlings naturally grow at different rates.',
        zh: '油棕苗的高度、叶片发育及整体外观可能会有些差异，这是正常的，因为每棵苗的生长速度并不完全相同。',
      },
    ],
  },
  {
    id: 'sec-orders',
    title: '2. 库存、价格与订购 · Stock, Pricing & Orders',
    items: [
      {
        id: 'q8',
        q: 'Q8. 现在有现货吗？ / Do you have ready stock?',
        en: 'Stock availability may change from time to time. Kindly refer to our website for the latest stock availability before placing your order.',
        zh: '库存情况会随时变动，您可以在下单前参考我们的网站查看最新库存情况。',
      },
      {
        id: 'q9',
        q: 'Q9. 多少钱一棵？ / How much is one seedling?',
        en: 'Our standard price is RM25.00 per seedling. Prices may vary during promotional periods or special offers. Kindly contact us or visit our website for the latest pricing.',
        zh: '我们的标准售价为每棵 RM25.00。促销活动或特别优惠期间，价格可能会有所调整。欢迎联系我们或参阅我们的官方网站，以获取最新价格信息。',
      },
      {
        id: 'q10',
        q: 'Q10. 我想订苗，要怎样下单？ / How do I place an order?',
        en: 'You may place your order through our online ordering system. Kindly contact us for the ordering link and instructions.',
        zh: '您可以通过我们的线上订购系统下单。欢迎联系我们获取订购链接及相关指引。',
      },
      {
        id: 'q11',
        q: 'Q11. 可以预订未来的苗吗？ / Can I book seedlings for a future date?',
        en: 'Yes, subject to stock availability and our booking terms. All bookings are only confirmed and effective upon receipt of full payment. Kindly contact us to check stock availability and booking arrangements.',
        zh: '可以，具体需视库存及预订条件而定。所有预订须在全额付款后方正式生效。欢迎联系我们确认库存及预订安排。',
      },
      {
        id: 'q12',
        q: 'Q12. 可以先预留苗吗？ / Can I reserve seedlings first?',
        en: 'Seedlings are only reserved upon payment. We do not offer reservation without payment, and stock is subject to availability until payment is made.',
        zh: '种苗只有在完成付款后才会正式预留。我们不提供未付款的预留服务，付款前库存仍可能变动。',
      },
      {
        id: 'q13',
        q: 'Q13. 付款后才算确认订单吗？ / Is my order confirmed after payment?',
        en: 'Yes, your order and seedling reservation will only be confirmed upon payment. Please ensure payment is completed to secure your seedlings.',
        zh: '是的，订单及种苗预留只有在完成付款后才正式确认。请确保完成付款，以便确认您的种苗。',
      },
      {
        id: 'q14',
        q: 'Q14. 可以赊账吗？ / Can I purchase on credit?',
        en: 'Our current sales arrangement requires payment before collection. We are unable to offer credit purchases under the current arrangement.',
        zh: '目前我们的销售安排为领取前付款，暂不提供赊账服务。',
      },
    ],
  },
  {
    id: 'sec-collection',
    title: '3. 领取油棕苗 · Seedling Collection',
    items: [
      {
        id: 'q15',
        q: 'Q15. 怎样预约领取？ / How do I book a collection slot?',
        en: (
          <>All seedling collections must be booked online. You may make your collection booking and check your booking confirmation through the link below:<br/>
          <a href="https://collect.mjmnursery.com/" target="_blank" rel="noopener" style={css('color:var(--green-mid);font-weight:500;')}>https://collect.mjmnursery.com/</a></>
        ),
        zh: (
          <>所有种苗领取都必须通过线上预约。您可以通过以下链接预约领取时间及查看预约确认信息：<br/>
          <a href="https://collect.mjmnursery.com/" target="_blank" rel="noopener" style={css('color:var(--green-mid);font-weight:500;')}>https://collect.mjmnursery.com/</a></>
        ),
      },
      {
        id: 'q16',
        q: 'Q16. 可以直接来领取吗？ / Can I walk in to collect?',
        en: 'We recommend making an online collection booking before coming to the nursery to ensure your collection arrangements are confirmed.',
        zh: '建议您在前往苗圃之前先完成线上领取预约，以确保领取安排已确认。',
      },
      {
        id: 'q17',
        q: 'Q17. 可以自己选择苗吗？ / Can I choose my own seedlings?',
        en: 'Customers may select seedlings during the designated selection or collection process, subject to our nursery arrangements and stock availability.',
        zh: '客户可在指定的选苗或领取流程中选择种苗，具体需遵守苗圃安排及库存情况。',
      },
      {
        id: 'q18',
        q: 'Q18. 可以去不同的 Plot 领取吗？ / Can I collect from different plots?',
        en: 'Collection locations may vary depending on the variety and stock availability. Customers must follow the collection location and other collection arrangements as instructed by the nursery.',
        zh: '领取地点可能会根据品种及库存情况而有所不同。客户须遵从苗场指定的领取地点及其他相关领取安排。',
      },
      {
        id: 'q19',
        q: 'Q19. 可以更改领取日期吗？ / Can I reschedule my collection date?',
        en: 'Yes, subject to the available collection slots. Please update your booking through our online collection system.',
        zh: '可以，但需视可预约的领取时段而定。请通过我们的线上领取系统更新预约。',
      },
      {
        id: 'q20',
        q: 'Q20. 领取时需要带什么？ / What should I bring for collection?',
        en: 'Please bring your order confirmation and ensure that your payment has been completed. Kindly follow the collection instructions provided by our nursery staff.',
        zh: '领取时请携带订单确认信息，并确保已完成付款。请遵循苗圃工作人员提供的领取指示。',
      },
    ],
  },
  {
    id: 'sec-planting',
    title: '4. 种植及售后问题 · Planting & After-Sales',
    items: [
      {
        id: 'q21',
        q: 'Q21. 领取苗后应该怎样照顾？ / How should I care for the seedlings after collection?',
        en: 'Please ensure that seedlings are transported carefully and planted as soon as practicable. Avoid leaving them exposed to excessive heat or without sufficient water for prolonged periods.',
        zh: '领取后请妥善运输种苗，并尽早进行种植。避免长时间暴露在高温环境或缺水的情况下。',
      },
      {
        id: 'q22',
        q: 'Q22. 每天需要浇多少水？ / How much water is required daily?',
        en: 'Water requirements depend on weather conditions, soil moisture and planting conditions. Ensure that the seedlings receive sufficient water and do not allow them to dry out.',
        zh: '浇水量需视天气、土壤湿度及种植环境而定。请确保种苗有足够的水分，避免苗体干旱缺水。',
      },
    ],
  },
  {
    id: 'sec-payment',
    title: '5. 付款及文件申请 · Payment & Document Requests',
    items: [
      {
        id: 'q23',
        q: 'Q23. What payment methods do you accept? / 你们接受哪些付款方式？',
        en: 'All payments must be made online through the payment options available on our website. We do not accept cash payments. If you require assistance with payment, kindly contact us.',
        zh: '所有付款须通过我们官方网站提供的线上付款方式完成，苗场不接受现金付款。如您在付款过程中需要协助，欢迎联系我们。',
      },
      {
        id: 'q24',
        q: 'Q24. Is full payment required to confirm my order? / 订单是否需要全额付款才能确认？',
        en: 'Yes. All orders and bookings are only confirmed and effective upon receipt of full payment. Unpaid orders or bookings will not be considered confirmed.',
        zh: '是的。所有订单及预订须在全额付款后方正式生效。未完成全额付款的订单或预订将不视为正式确认。',
      },
      {
        id: 'q25',
        q: 'Q25. Can I collect my seedlings before making full payment? / 我可以在未付清款项前领取油棕苗吗？',
        en: 'No. Full payment must be made before seedlings can be collected. Seedlings will only be released upon confirmation of full payment.',
        zh: '不行。领取油棕苗前须完成全额付款。苗场仅在确认收到全额款项后安排放苗。',
      },
      {
        id: 'q26',
        q: 'Q26. How do I submit my payment proof? / 如何提交付款凭证？',
        en: 'You may upload your payment proof during checkout or later under My Order on our website.',
        zh: '您可在结账时上传付款凭证，或稍后前往网站 My Order（我的订单） 上传。',
      },
      {
        id: 'q27',
        q: 'Q27. How can I request an E-Invoice? / 如何申请电子发票？',
        en: (
          <>Please refer to our <a href="/?policy=einvoice" onClick={(e) => { e.preventDefault(); window.showPage('information'); setTimeout(function(){ window.switchPolicyTab && window.switchPolicyTab('einvoice'); }, 40); }} style={css('color:var(--green-mid);font-weight:500;cursor:pointer;')}>E-Invoice Guidelines</a> for the request procedures and requirements.</>
        ),
        zh: (
          <>如需申请 E-Invoice（电子发票），请参阅我们的 <a href="/?policy=einvoice" onClick={(e) => { e.preventDefault(); window.showPage('information'); setTimeout(function(){ window.switchPolicyTab && window.switchPolicyTab('einvoice'); }, 40); }} style={css('color:var(--green-mid);font-weight:500;cursor:pointer;')}>E-Invoice 申请指引</a>，了解申请流程及所需资料。</>
        ),
      },
      {
        id: 'q28',
        q: 'Q28. How can I request a regular Invoice (INV)? / 如何申请普通发票？',
        en: 'Kindly contact us through our official communication channels and provide your order number and billing details for processing.',
        zh: '如需申请普通 Invoice（发票），请通过我们的官方联系渠道联系我们，并提供订单编号及相关开票资料，以便处理。',
      },
      {
        id: 'q29',
        q: 'Q29. Where can I get my Receipt? / 如何获取收据？',
        en: 'Your receipt is available directly under your order on our website.',
        zh: '您可直接在我们网站的订单页面查看及获取收据。',
      },
      {
        id: 'q30',
        q: 'Q30. How can I request a Delivery Order (DO)? / 如何申请交货单（DO）？',
        en: 'All Delivery Orders (DO) are available electronically through our website. If you require a hardcopy, kindly visit our office and request assistance from our nursery staff.',
        zh: '所有 交货单（DO）均可通过我们的网站获取。如需纸本，请到办公室向苗场工作人员寻求协助，我们将为您准备。',
      },
      {
        id: 'q31',
        q: 'Q31. Can I request other documents from the nursery? / 我可以向苗场申请其他文件吗？',
        en: 'Yes. For other document requests, kindly contact us and specify the type of document required, together with your order or company details where applicable. All requests are subject to verification and the nursery’s approval.',
        zh: '可以。如需申请其他文件，请联系我们并说明所需文件类型，以及相关订单或公司资料（如适用）。所有文件申请须经过资料核实及苗场审核。',
      },
      {
        id: 'q32',
        q: 'Q32. Can I request a statement of account? / 我可以申请账单对账单吗？',
        en: (
          <>To request a Statement of Account, kindly email us at <a href="mailto:megajutamassb@outlook.com" style={css('color:var(--green-mid);font-weight:500;')}>megajutamassb@outlook.com</a> and indicate your company name and the relevant period.</>
        ),
        zh: (
          <>如需申请 Statement of Account（账单对账单），请电邮至：<a href="mailto:megajutamassb@outlook.com" style={css('color:var(--green-mid);font-weight:500;')}>megajutamassb@outlook.com</a>，并注明公司名称及所需账单期间。</>
        ),
      },
      {
        id: 'q33',
        q: 'Q33. How long does it take to process document requests? / 文件申请需要多久处理？',
        en: 'Document requests will be processed within our operating hours and subject to the availability of the required information. Kindly allow reasonable time for processing.',
        zh: '文件申请将于苗场营业时间内处理，具体处理时间视所需资料的完整性及可用性而定。请给予我们合理的处理时间。',
      },
    ],
  },
];

function jumpToFaq(id, e){
  if (e && e.preventDefault) e.preventDefault();
  var el = document.getElementById(id);
  if (!el) return;
  // Offset by the fixed nav's real height so the question heading isn't hidden under it.
  var nav = document.getElementById('navbar');
  var navH = nav ? nav.getBoundingClientRect().height : 144;
  var top = el.getBoundingClientRect().top + window.pageYOffset - navH - 20;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  el.style.transition = 'background-color .3s';
  el.style.backgroundColor = 'var(--green-pale)';
  setTimeout(function(){ el.style.backgroundColor = ''; }, 1600);
  try {
    var url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, '', url.toString());
  } catch(_){}
}

export default function FaqPage() {
  return (
    <div className="page" id="page-faq">

      <div className="page-hero">
        <div className="page-hero-content">
          <div className="breadcrumb" onClick={() => window.showPage('home')}>Home <span>/ FAQ</span></div>
          <h1>Frequently Asked <em>Questions</em></h1>
        </div>
      </div>

      <div className="info-page">
        <div className="info-policies">
          <span className="section-label">Help Centre · 常见问题</span>
          <h2 className="section-title">About <em>MJM</em></h2>

          {/* Table of contents — click a question to jump to its answer. */}
          <div style={css(tocCardStyle + 'margin-bottom:1.5rem;')}>
            <h3 style={css('color:var(--text-dark);font-size:14px;font-weight:600;margin:0 0 .5rem;letter-spacing:.5px;text-transform:uppercase;')}>目录 · Contents</h3>
            <p style={css('color:var(--text-light);font-size:12.5px;margin:0 0 1rem;')}>Click any question to jump to its answer. · 点击任一问题即可直接跳转到答案。</p>
            {SECTIONS.map((sec, i) => (
              <div key={sec.id} style={css(i === 0 ? 'margin-top:0' : 'margin-top:1.25rem')}>
                <div style={css(i === 0 ? sectionHeadingFirstStyle : sectionHeadingStyle)}>{sec.title}</div>
                {sec.items.map((it) => (
                  <a
                    key={it.id}
                    href={'#' + it.id}
                    onClick={(e) => jumpToFaq(it.id, e)}
                    style={css(tocLinkStyle)}
                    onMouseOver={(e) => { e.currentTarget.style.color = 'var(--green-dark)'; e.currentTarget.style.background = 'var(--green-pale)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-mid)'; e.currentTarget.style.background = 'transparent'; }}
                  >{it.q}</a>
                ))}
              </div>
            ))}
          </div>

          {/* Answers — grouped by section, each anchor is the TOC target. */}
          {SECTIONS.map((sec) => (
            <div key={sec.id} id={sec.id} style={css('scroll-margin-top:110px;')}>
              <h3 style={css('color:var(--text-dark);font-size:18px;font-weight:600;margin:2rem 0 1rem;')}>{sec.title}</h3>
              <div style={css(cardStyle)}>
                {sec.items.map((it, idx) => (
                  <div key={it.id} id={it.id} style={css(qAnchorOffset + (idx > 0 ? 'margin-top:1.5rem;padding-top:1.5rem;border-top:1px dashed rgba(0,0,0,.08);' : ''))}>
                    <h4 style={css(qHeadingStyle)}>{it.q}</h4>
                    <p style={css(answerEnStyle)}>{it.en}</p>
                    <p style={css(answerZhStyle)}>{it.zh}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

        </div>
      </div>

    </div>
  );
}
