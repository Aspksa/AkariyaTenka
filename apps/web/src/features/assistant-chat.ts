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

 const controls=document.createElement("form");controls.className="akariya-ai-brain-controls";
 const keyLabel=document.createElement("label");keyLabel.textContent="API-ключ Cloud.ru (защищён локально)";
 const keyInput=document.createElement("input");keyInput.type="password";keyInput.placeholder="Вставьте ключ один раз";keyInput.autocomplete="off";keyInput.spellcheck=false;keyInput.setAttribute("aria-label","Cloud.ru API-ключ");keyLabel.append(keyInput);
 const modelLabel=document.createElement("label");modelLabel.textContent="Модель";
 const modelSelect=document.createElement("select");modelSelect.setAttribute("aria-label","Модель Cloud.ru");modelLabel.append(modelSelect);
 const loadModels=document.createElement("button");loadModels.type="button";loadModels.textContent="Получить модели Cloud.ru";
 const tempLabel=document.createElement("label");tempLabel.textContent="Температура (0–2)";
 const tempInput=document.createElement("input");tempInput.type="number";tempInput.min="0";tempInput.max="2";tempInput.step="0.1";tempInput.value="0.5";tempLabel.append(tempInput);
 const topLabel=document.createElement("label");topLabel.textContent="Top P (0–1)";
 const topInput=document.createElement("input");topInput.type="number";topInput.min="0.01";topInput.max="1";topInput.step="0.01";topInput.value="0.95";topLabel.append(topInput);
 const limitLabel=document.createElement("label");limitLabel.textContent="Максимум токенов ответа";
 const limitInput=document.createElement("input");limitInput.type="number";limitInput.min="64";limitInput.max="16384";limitInput.step="1";limitInput.value="2048";limitLabel.append(limitInput);
 const saveBrain=document.createElement("button");saveBrain.type="submit";saveBrain.textContent="Сохранить настройки";
 const removeKey=document.createElement("button");removeKey.type="button";removeKey.textContent="Удалить сохранённый ключ";
 const brainResult=document.createElement("p");brainResult.setAttribute("role","status");
 controls.append(keyLabel,modelLabel,loadModels,tempLabel,topLabel,limitLabel,saveBrain,removeKey,brainResult);
 settings.append(controls);
 const setModel=(model:string)=>{if(!Array.from(modelSelect.options).some(o=>o.value===model)){const o=document.createElement("option");o.value=model;o.textContent=model;modelSelect.append(o);}modelSelect.value=model;};
 setModel("ai-sage/GigaChat3-10B-A1.8B");
 async function fetchModels():Promise<void>{
   loadModels.disabled=true;brainResult.textContent="Загрузка моделей Cloud.ru…";
   try {
     const r=await fetch("/api/assistant/models",{cache:"no-store"});
     const body=await r.json() as {models?:Array<{id:string;name:string}>;error?:{message?:string}};
     if(!r.ok)throw Error(body.error?.message??"HTTP "+r.status);
     const current=modelSelect.value;modelSelect.replaceChildren();
     for(const model of body.models??[]){const option=document.createElement("option");option.value=model.id;option.textContent=model.name+" ("+model.id+")";modelSelect.append(option);}
     setModel(current);brainResult.textContent="Каталог моделей загружен: "+(body.models?.length??0);
   } catch(error){brainResult.textContent=error instanceof Error?error.message:String(error);}
   finally{loadModels.disabled=false;}
 }
 loadModels.addEventListener("click",()=>{void fetchModels();});
 controls.addEventListener("submit",event=>{event.preventDefault();saveBrain.disabled=true;
   void (async()=>{try{
     const settingsValue={model:modelSelect.value,temperature:Number(tempInput.value),topP:Number(topInput.value),maxCompletionTokens:Number(limitInput.value)};
     const payload={settings:settingsValue,...(keyInput.value?{key:keyInput.value}:{})};
     const r=await fetch("/api/assistant/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
     const body=await r.json() as {error?:{message?:string}};
     if(!r.ok)throw Error(body.error?.message??"HTTP "+r.status);
     keyInput.value="";brainResult.textContent="Настройки сохранены";await refresh();
   }catch(error){brainResult.textContent=error instanceof Error?error.message:String(error);}
   finally{saveBrain.disabled=false;}})();
 });
 removeKey.addEventListener("click",()=>{if(!window.confirm("Удалить локально сохранённый ключ Cloud.ru?"))return;
   void (async()=>{try{const r=await fetch("/api/assistant/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({removeKey:true})});
   if(!r.ok)throw Error("HTTP "+r.status);keyInput.value="";brainResult.textContent="Ключ удалён";await refresh();}
   catch(error){brainResult.textContent=String(error);}})();
 });
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
     const data=await response.json() as {configured:boolean;model:string|null;provider?:string;keyStored?:boolean;settings?:{model:string;temperature:number;topP:number;maxCompletionTokens:number}};
     if(data.settings){setModel(data.settings.model);tempInput.value=String(data.settings.temperature);topInput.value=String(data.settings.topP);limitInput.value=String(data.settings.maxCompletionTokens);}
     status.textContent=(data.keyStored?"Ключ защищён и сохранён. ":"")+ (data.configured?"Провайдер: "+(data.provider??"AI")+" · Модель: "+data.model:"Модель не подключена");
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
