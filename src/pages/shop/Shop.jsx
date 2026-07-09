import React from 'react';
import '../../styles/shop.css';
import Splash from './Splash.jsx';
import Nav from './Nav.jsx';
import LogoFly from './LogoFly.jsx';
import HomePage from './HomePage.jsx';
import InformationPage from './InformationPage.jsx';
import ContactPage from './ContactPage.jsx';
import JoinPage from './JoinPage.jsx';
import CalculatorPage from './CalculatorPage.jsx';
import QuotationPage from './QuotationPage.jsx';
import PortalPage from './PortalPage.jsx';
import PortalModals from './PortalModals.jsx';
import LoginModal from './LoginModal.jsx';
import FooterSection from './FooterSection.jsx';
import ProductPopup from './ProductPopup.jsx';
import WaFloat from './WaFloat.jsx';
import { css } from './css.js';

// MJM Nursery storefront — React port of public/index.html. Pure markup
// shell: all behaviour lives in main.js (ported inline script), which runs
// once after this tree is committed and drives the DOM imperatively exactly
// like the original page did. Section order matches the original body.
export default function Shop() {
  return (
    <>
      <Splash />
      <Nav />
      <LogoFly />
      <HomePage />
      <InformationPage />
      <ContactPage />
      <JoinPage />
      <CalculatorPage />
      <QuotationPage />
      <PortalPage />
      <PortalModals />
      {/* CHECKOUT LOGIN PAGE — router target only; showPage() opens the
          shared login modal when this page becomes active. */}
      <div className="page" id="page-checkout-login"></div>
      <LoginModal />
      {/* PORTAL TOAST */}
      <div
        id="portal-toast"
        style={css(
          'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%) translateY(80px);background:var(--green-dark);color:#fff;padding:.7rem 1.4rem;border-radius:10px;font-size:.84rem;font-weight:600;z-index:999;opacity:0;transition:all .3s;white-space:nowrap;'
        )}
      ></div>
      <FooterSection />
      <ProductPopup />
      <WaFloat />
    </>
  );
}
