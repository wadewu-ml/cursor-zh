export namespace core {
	
	export class ActionResult {
	    success: boolean;
	    message: string;
	    logs: string[];
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new ActionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.logs = source["logs"];
	        this.error = source["error"];
	    }
	}
	export class CursorStatus {
	    locale: string;
	    state: string;
	    installDir: string;
	    userDataDir: string;
	    cursorVersion: string;
	    vscodeVersion: string;
	    executablePath: string;
	    workbenchHtmlPath: string;
	    isRunning: boolean;
	    hasLanguagePack: boolean;
	    hasScriptInjection: boolean;
	    hasTrayPatch: boolean;
	    hasValidScript: boolean;
	    localizationBuild: string;
	    checksumsValid: boolean;
	    mismatchedChecksums: string[];
	    message: string;
	    canApply: boolean;
	    canRestore: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CursorStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.locale = source["locale"];
	        this.state = source["state"];
	        this.installDir = source["installDir"];
	        this.userDataDir = source["userDataDir"];
	        this.cursorVersion = source["cursorVersion"];
	        this.vscodeVersion = source["vscodeVersion"];
	        this.executablePath = source["executablePath"];
	        this.workbenchHtmlPath = source["workbenchHtmlPath"];
	        this.isRunning = source["isRunning"];
	        this.hasLanguagePack = source["hasLanguagePack"];
	        this.hasScriptInjection = source["hasScriptInjection"];
	        this.hasTrayPatch = source["hasTrayPatch"];
	        this.hasValidScript = source["hasValidScript"];
	        this.localizationBuild = source["localizationBuild"];
	        this.checksumsValid = source["checksumsValid"];
	        this.mismatchedChecksums = source["mismatchedChecksums"];
	        this.message = source["message"];
	        this.canApply = source["canApply"];
	        this.canRestore = source["canRestore"];
	    }
	}
	export class UpdateInfo {
	    available: boolean;
	    currentVersion: string;
	    latestVersion: string;
	    releaseNotes: string;
	    downloadUrl: string;
	    assetName: string;
	    checksumUrl: string;
	    sha256: string;
	    configured: boolean;
	    // Go type: time
	    publishedAt?: any;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.releaseNotes = source["releaseNotes"];
	        this.downloadUrl = source["downloadUrl"];
	        this.assetName = source["assetName"];
	        this.checksumUrl = source["checksumUrl"];
	        this.sha256 = source["sha256"];
	        this.configured = source["configured"];
	        this.publishedAt = this.convertValues(source["publishedAt"], null);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

