<!-- 在 HTML 头部引入依赖库 (使用 CDN) -->
// static/js/encrypts.js

(function () {
    // 兼容浏览器全局变量
    const CryptoJS = window.CryptoJS;
    const CryptoSM = window.smCrypto; // sm-crypto 在浏览器中暴露为 smCrypto

    const object2string = (data) => {
        if (typeof data === 'object') return JSON.stringify(data);
        let str = JSON.stringify(data);
        if (str.startsWith("'") || str.startsWith('"')) str = str.substring(1);
        if (str.endsWith("'") || str.endsWith('"')) str = str.substring(0, str.length - 1);
        return str;
    };

    const stringToHex = (str) => {
        let hex = '';
        for (let i = 0; i < str.length; i++) {
            hex += str.charCodeAt(i).toString(16).padStart(2, '0');
        }
        return hex;
    };

    const AES_KEY = window.constom_aes_key || 'AwlFgldrtvfhbPg3';
    const AES = {
        encryptData(data) {
            const utf8Data = CryptoJS.enc.Utf8.parse(object2string(data));
            const key = CryptoJS.enc.Utf8.parse(AES_KEY);
            const encrypted = CryptoJS.AES.encrypt(utf8Data, key, {
                mode: CryptoJS.mode.ECB,
                padding: CryptoJS.pad.Pkcs7
            });
            return CryptoJS.enc.Base64.stringify(encrypted.ciphertext);
        },
        decryptData(data) {
            const base64Data = CryptoJS.enc.Base64.parse(data);
            const key = CryptoJS.enc.Utf8.parse(AES_KEY);
            return CryptoJS.AES.decrypt({ciphertext: base64Data}, key, {
                mode: CryptoJS.mode.ECB,
                padding: CryptoJS.pad.Pkcs7
            }).toString(CryptoJS.enc.Utf8);
        }
    };

    const SM4_KEY = window.constom_sm4_key || 'HddflodfjIslfVd3';


    const SM4 = {
        encryptData(data) {
            const enc = CryptoSM.sm4.encrypt(object2string(data), stringToHex(SM4_KEY));
            return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(enc));
        },
        decryptData(data) {
            const base64Data = CryptoJS.enc.Base64.parse(data);
            const decode64Str = CryptoJS.enc.Utf8.stringify(base64Data);
            return CryptoSM.sm4.decrypt(decode64Str, stringToHex(SM4_KEY));
        }
    };

    // 默认使用 AES，切换国密请改为 const EncyptObject = SM4;
    const EncyptObject = AES;

    // 挂载到全局对象，方便其他 JS 文件调用
    window.EncryptUtils = {
        encryptData: (data) => (!data ? null : EncyptObject.encryptData(data)),
        decryptData: (data) => (!data ? null : EncyptObject.decryptData(data)),
        encryptPacket: (data) => ({encrypt:true, data: EncyptObject.encryptData(data)}),
        decryptPacket: (packet) => {
            if(!packet || !packet.encrypt) return packet;
            try { return JSON.parse(EncyptObject.decryptData(packet.data)); }
            catch(e){ console.error(e); return packet; }
        }
    };
})();
