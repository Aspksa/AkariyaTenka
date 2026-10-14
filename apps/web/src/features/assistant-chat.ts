export function mountAssistantAvatar(): void {
 const avatar=document.createElement("button");
 avatar.type="button";avatar.className="akariya-ai-avatar";avatar.title="Открыть чат Akariya";avatar.setAttribute("aria-label","Открыть чат Akariya");
 avatar.textContent="🦊";
 const chat=document.createElement("section");chat.className="akariya-ai-chat";chat.hidden=true;chat.setAttribute("aria-label","Чат с Akariya");
 const header=document.createElement("header");header.className="akariya-ai-head";
 const title=document.createElement("strong");title.textContent="Akariya · Чат";
 const options=document.createElement("button");options.type="button";options.textContent="⚙";options.title="Настройки ИИ";
 const close=document.createElement("button");close.type="button";close.textContent="×";close.title="Закрыть чат";
 header.append(title,options,close);
 const log=document.createElement("div");log.className="akariya-ai-messages";log.setAttribute("aria-live","polite");
 const form=document.createElement("form");form.className="akariya-ai-form";
 const input=document.createElement("textarea");input.rows=2;input.maxLength=8000;input.placeholder="Сообщение для Akariya…";input.setAttribute("aria-label","Сообщение");
 const send=document.createElement("button");send.type="submit";send.textContent="Отправить";
 form.append(input,send);
 const settings=document.createElement("aside");settings.className="akariya-ai-settings";settings.hidden=true;
 const heading=document.createElement("h3");heading.textContent="Настройки · Мозг ИИ";
 const status=document.createElement("p");status.textContent="Проверка подключения…";
 const memory=document.createElement("p");memory.textContent="Память: локальное хранение разговоров";
 const rememberHint=document.createElement("p");rememberHint.textContent="Долговременная память: напишите «Запомни: ...» в чате. Обычные сообщения не сохраняются как факты автоматически.";
 const hint=document.createElement("p");hint.textContent="Cloud.ru: настройте AKARIYA_CLOUDRU_API_KEY и при необходимости AKARIYA_CLOUDRU_MODEL в окружении запуска. Ключ никогда не вводится в браузере.";
 settings.append(heading,status,memory,rememberHint,hint);
 chat.append(header,log,settings,form);
 document.body.append(avatar,chat);
 let sessionId:string|undefined;
 try {const id=localStorage.getItem("akariya-ai-session-id");if(id && /^[A-Za-z0-9_-]{8,128}$/.test(id))sessionId=id;}catch{/* Storage can be disabled. */}
 function append(role:string,value:string):void {
   const node=document.createElement("p");node.className="akariya-ai-msg "+role;
   node.textContent=value;log.append(node);log.scrollTop=log.scrollHeight;
 }
 async function refresh():Promise<void>{
   try {const response=await fetch("/api/assistant/status",{cache:"no-store"});
     if(!response.ok)throw Error("HTTP "+response.status);
     const data=await response.json() as {configured:boolean;model:string|null;provider?:string};
     status.textContent=data.configured?"Провайдер: "+(data.provider??"AI")+" · Модель: "+data.model:"Модель не подключена";
   }catch{status.textContent="Состояние ИИ недоступно";}
 }
 avatar.addEventListener("click",()=>{chat.hidden=!chat.hidden;if(!chat.hidden){void refresh();input.focus();}});
 close.addEventListener("click",()=>{chat.hidden=true;avatar.focus();});
 options.addEventListener("click",()=>{settings.hidden=!settings.hidden;if(!settings.hidden)void refresh();});
 form.addEventListener("submit",event=>{event.preventDefault();const text=input.value.trim();if(!text||send.disabled)return;
   append("user",text);input.value="";send.disabled=true;
   void (async()=>{try{const response=await fetch("/api/assistant/turn",{
     method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},
     body:JSON.stringify({text,...(sessionId?{sessionId}:{})})
   });const body=await response.json() as {status?:string;sessionId?:string;text?:string;error?:{message?:string}};
   if(!response.ok)throw Error(body.error?.message??"HTTP "+response.status);
   if(body.sessionId){sessionId=body.sessionId;try{localStorage.setItem("akariya-ai-session-id",sessionId);}catch{/* Session continues in memory. */}}
   append("assistant",body.text??"Ответ модели пока недоступен");
   }catch(error){append("error",error instanceof Error?error.message:String(error));}
   finally{send.disabled=false;input.focus();}})();
 });
}
