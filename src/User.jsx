import React, {useState, Component, useRef, useEffect} from 'react';
import classnames from 'classnames';
import styles from './Header.module.css';
import {discordClientId} from '../constants';
import {parseQuery} from '../util.js';
import Modal from './components/modal';
import WebaWallet from './components/wallet';

import {MetamaskWallet} from '../blockchain/metamask';

const User = ({address, setAddress, open, setOpen, toggleOpen, setLoginFrom, chain, setChain}) => {
  const [show, setShow] = useState(false);

  const showModal = async e => {
    e.preventDefault();
    setShow(!show);
  };

  const [loggingIn, setLoggingIn] = useState(false);
  const [loginButtons, setLoginButtons] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [autoLoginRequestMade, setAutoLoginRequestMade] = useState(false);

  const metaMaskLogin = async e => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (address) {
      toggleOpen('user');
    } else {
      if (!loggingIn) {
        setLoggingIn(true);
        // If metamask is locked sometimes promise gets stuck, therefore if in 5 second
        // no response is received, set the logging in to false so user can try again
        setTimeout(() => setLoggingIn(false), 5000);
        try {
          const metamaskWallet = new MetamaskWallet();
          const address = await metamaskWallet.initMetamaskWallet();
          if (address) {
            setAddress(address);
            setLoginFrom('metamask');
            setShow(false);
            setLoginFrom('metamask');
            localStorage.setItem('metamaskConnected', 'true');
            setChain(await metamaskWallet.getChainInfo());
          }
        } catch (err) {
          console.warn(err);
          window.alert(err.message);
          localStorage.setItem('metamaskConnected', 'false');
        } finally {
          setLoggingIn(false);
        }
      }
    }
  };

  useEffect(() => {
    const {
      error,
      code,
      id,
      play,
      realmId,
      twitter: arrivingFromTwitter,
    } = parseQuery(window.location.search);
    if (!autoLoginRequestMade) {
      setAutoLoginRequestMade(true);
      if (localStorage.getItem('metamaskConnected') === 'true') {
        metaMaskLogin();
      }

      if (code) {
        setLoggingIn(true);
        WebaWallet.waitForLaunch().then(async ()=>{
          const {address, error} = await WebaWallet.loginDiscord(code, id);

          if (address) {
            setAddress(address);
            setLoginFrom('discord');
            setShow(false);
          } else if (error) {
            setLoginError(String(error).toLocaleUpperCase());
          }
          window.history.pushState({}, '', window.location.origin);
          setLoggingIn(false);
        }); // it may occur that wallet loading is in progress already
      } else {
        WebaWallet.waitForLaunch().then(async ()=>{
          const {address, error} = await WebaWallet.autoLogin();
          if (address) {
            setAddress(address);
            setLoginFrom('discord');
            setShow(false);
          } else if (error) {
            setLoginError(String(error).toLocaleUpperCase());
          }
        }) // it may occur that wallet loading is in progress already
      }
    }
  }, [address, setAddress]);

  return (
    <div>
      <div className={classnames(styles.user, loggingIn ? styles.loggingIn : null)}
        onClick={async e => {
          e.preventDefault();
          e.stopPropagation();
          if (address) {
            toggleOpen('user');
          } else {
            setLoginButtons(true);
            setOpen(null);
            setOpen('login');
          }
        }}>
        <img src="images/soul.png" className={styles.icon} />
        <div className={styles.name} onClick={e => { showModal(e); }}>
          {loggingIn ? 'Logging in... ' : (address || (loginError || 'Log in'))}
        </div>
      </div>
      { address
        ? <div className={styles.logoutBtn}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            WebaWallet.logout();
            setAddress(null);
            localStorage.removeItem('metamaskConnected');
          }}
        >Logout</div>
        : ''
      }
      {
        open === 'login'
          ? <div className={styles.login_options}>
            {
              loginButtons ? <>
                <Modal onClose={ showModal } show={show}>
                  <div className={styles.loginDiv}>
                    <div className={styles.loginBtn} onClick={ metaMaskLogin }>
                      <div className={styles.loginBtnText}>
                        <img className={styles.loginBtnImg} src="images/metamask.png" alt="metamask" width="28px"/>
                        <span>MetaMask</span>
                      </div>
                    </div>
                    <a href={`https://discord.com/api/oauth2/authorize?client_id=${discordClientId}&redirect_uri=${window.location.origin}%2Flogin&response_type=code&scope=identify`}>
                      <div className={styles.loginBtn} style={{marginTop: '10px'}}>
                        <div className={styles.loginBtnText}>
                          <img className={styles.loginBtnImg} src="images/discord-dark.png" alt="discord" width="28px"/>
                          <span>Discord</span>
                        </div>
                      </div>
                    </a>
                  </div>
                </Modal>
              </> : ''
            }
          </div>
          : <div></div>}

    </div>
  );
};

export default User;
