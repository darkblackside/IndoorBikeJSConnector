import { ApplicationFramework } from "./applicationFramework.js";

function startListening()
{
	const framework = new ApplicationFramework();
	framework.startListening();
}

(<any>window).startListening = startListening;