import compareVersions from 'compare-versions';
const {shell} = require('electron');

import CommonConstants from '../../utils/CommonConstants';
import CommonActions from '../../actions/CommonActions';

const RELEASE_URL = 'https://api.github.com/repos/Andy1001Yu/MQTTBox/releases/latest';

function releaseVersion(tag) {
    if(typeof tag !== 'string' || tag.length > 128) return null;
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(tag);
    if(!match || (match[4] && match[4].split('.').some(part => /^0\d+$/.test(part)))) return null;
    // Build metadata does not affect precedence; normalize the optional Git tag prefix.
    return tag.replace(/^v/, '').split('+')[0];
}

class PlatformUtils {

    static async init() {
        try {
            const response = await fetch(RELEASE_URL, {
                method: 'GET',
                redirect: 'error',
                credentials: 'omit',
                headers: {Accept: 'application/vnd.github+json'},
                signal: AbortSignal.timeout(5000)
            });
            if(!response.ok || response.status !== 200 || response.url !== RELEASE_URL ||
                !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) return;
            const release = await response.json();
            if(!release || typeof release !== 'object' || Array.isArray(release) || release.draft === true) return;
            const latestVersion = releaseVersion(release.tag_name);
            const currentVersion = releaseVersion(CommonConstants.APP_VERSION);
            if(latestVersion && currentVersion && compareVersions(latestVersion, currentVersion) === 1) {
                CommonActions.showMessageToUser({message:'New version of MQTTBox is available for download - '+release.tag_name});
            }
        } catch(error) {
            // A missing release, offline connection, or invalid response must not interrupt startup.
        }
    }

    static openExternalLink(url) {
        try {
            if(typeof url !== 'string') return false;
            const link = new URL(url);
            if(link.protocol !== 'http:' && link.protocol !== 'https:') return false;
            return shell.openExternal(link.href).catch(() => false);
        } catch(error) {
            return false;
        }
    }
}

export default PlatformUtils;
