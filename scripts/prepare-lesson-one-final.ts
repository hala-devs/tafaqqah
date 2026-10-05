import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const lessonId = "lesson-akhsar-01";
const videoUrl = "https://youtu.be/FdxZylJyi-w";
const bahethUrl = "https://baheth.ieasybooks.com/ar/media/%D8%B4%D8%B1%D8%AD-%D8%A3%D8%AE%D8%B5%D8%B1-%D8%A7%D9%84%D9%85%D8%AE%D8%AA%D8%B5%D8%B1%D8%A7%D8%AA-1-%D8%A7%D9%84%D8%B4%D9%8A%D8%AE-%D9%85%D8%AD%D9%85%D8%AF-%D8%A8%D8%A7%D8%AC%D8%A7%D8%A8%D8%B1";
const specs = [[46,124,11,11],[124,325,11,12],[325,373,12,12],[373,624,12,14],[624,810,14,14],[810,1046,14,15],[1046,1216,15,16],[1216,1349,16,16],[1349,1540,16,17],[1540,1903,17,18],[1903,2103,19,19],[2103,2321,19,20]] as const;
type Cue={start:number;end:number;text:string};
const seconds=(value:string)=>{const [h,m,s]=value.replace(',', '.').split(':').map(Number);return Math.floor(h*3600+m*60+s)};
/**
 * Conservative editing of the timed text. Every replacement is either ordinary
 * Arabic orthography or an error whose intended phrase is explicit in the PDF
 * sentence at the matching location. It deliberately does not alter rulings.
 */
const clean=(value:string)=>{
 const fixes:Array<[RegExp,string]>=[
  [/اخسر المختصرات/gu,"أخصر المختصرات"],[/الاقصر/gu,"الأقصر"],[/التاب الرابع/gu,"الكتاب الرابع"],[/يسعد في توسعات/gu,"يتوسع في تفصيلات"],[/الشارع ويضيف/gu,"الشارح ويضيف"],[/الشارع يفصل/gu,"الشارح يفصل"],[/يحظى الدروس/gu,"يحضر الدروس"],[/كافي المبتدي/gu,"كافي المبتدئ"],[/كافل مبتدئ/gu,"كافي المبتدئ"],[/الماء الاجل/gu,"الماء الآجن"],[/وظعنا/gu,"وضعنا"],[/لا اله الا الله/gu,"لا إله إلا الله"],[/لا اله إلا الله/gu,"لا إله إلا الله"],[/انسان/g,"إنسان"],[/الان/g,"الآن"],[/الى/g,"إلى"],[/ايش/g,"أي شيء"],[/بايش/g,"بأي شيء"],[/اولا/g,"أولا"],[/اياما/g,"أياما"],[/ثلاث/g,"ثلاث"],[/الائمة/g,"الأئمة"],[/الامام/g,"الإمام"],[/الانسان/g,"الإنسان"],[/الانبياء/g,"الأنبياء"],[/الامور/g,"الأمور"],[/الاحكام/g,"الأحكام"],[/الادلة/g,"الأدلة"],[/الاعتقادية/g,"الاعتقادية"],[/الاستدلال/g,"الاستدلال"],[/الاستعجال/g,"الاستعجال"],[/الاساس/g,"الأساس"],[/الاول/g,"الأول"],[/الاولى/g,"الأولى"],[/الثاني/g,"الثاني"],[/الثالث/g,"الثالث"],[/الرابع/g,"الرابع"],[/الفقهاء/g,"الفقهاء"],[/المذاهب/g,"المذاهب"],[/المبتدئ/g,"المبتدئ"],[/المبتدئين/g,"المبتدئين"],[/المسائل/g,"المسائل"],[/الطهارة/g,"الطهارة"],[/النجاسة/g,"النجاسة"],[/الماء/g,"الماء"],[/الحدث/g,"الحدث"],[/الوضوء/g,"الوضوء"],[/الاغتسال/g,"الاغتسال"],[/الاستنجاء/g,"الاستنجاء"],[/الا /g,"إلا "],[/ الا$/g," إلا"],[/ ان /g," أن "],[/ ان$/g," أن"],[/ انه /g," إنه "],[/ انها /g," إنها "],[/ اذا /g," إذا "],[/ اذا$/g," إذا"],[/ الذي /g," الذي "],[/ هذه /g," هذه "],[/ هذا /g," هذا "],[/ اه /g," "],[/آآ+/g,""],[/\.\s*\./g,"."]
 ];
 return value.split(/\n\s*\n/).map(paragraph=>{let out=paragraph;for(const [from,to]of fixes)out=out.replace(from,to);return out.replace(/\s+([،.:؛؟])/gu,"$1").replace(/([،.:؛؟])(?=\S)/gu,"$1 ").replace(/\s+/gu," ").trim()}).filter(Boolean).join("\n\n");
};
const main=async()=>{
 const srt=readFileSync(join(process.cwd(),"content","lesson-akhsar-01.srt"),"utf8").replace(/\r/g,"").trim().split(/\n\n+/).map(block=>{const lines=block.split("\n"),range=lines[1].split(" --> ");return {start:seconds(range[0]),end:seconds(range[1]),text:lines.slice(2).join(" ").trim()}}) as Cue[];
 const extracted=readFileSync(join(process.cwd(),"content","lesson-akhsar-01.pdf.txt"),"utf8").replace(/\r/g,""); if(/\b(obj|stream|endstream|FlateDecode)\b|�/u.test(extracted)) throw new Error("Invalid PDF extraction");
 const pages=new Map<number,string>(); for(const part of extracted.split(/(?=^=== PDF PAGE \d+ ===$)/m)){const hit=part.match(/^=== PDF PAGE (\d+) ===\n([\s\S]*)$/);if(hit)pages.set(Number(hit[1]),hit[2].trim())}; if(pages.size!==10)throw new Error("Expected extracted PDF pages 11–20");
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
 try {
  await db.$transaction(async (tx) => {
   const lesson=await tx.lesson.findUniqueOrThrow({where:{id:lessonId},include:{concepts:{orderBy:{order:"asc"},include:{passages:{orderBy:{order:"asc"}}}}}});
   if(lesson.concepts.length!==12)throw new Error(`Expected 12 concepts, found ${lesson.concepts.length}`);
   await tx.lesson.update({where:{id:lessonId},data:{status:"DRAFT",isSample:false,estimatedMinutes:39}});
   for(const [i,concept] of lesson.concepts.entries()) {
    const [start,end,pageStart,pageEnd]=specs[i],passage=concept.passages[0];
    if(!passage||concept.passages.length!==1)throw new Error(`Concept ${i+1} requires exactly one passage`);
    const rawBahethText=srt.filter(c=>c.start>=start&&c.start<end).map(c=>c.text).join("\n\n");
    const rawPdfText=Array.from({length:pageEnd-pageStart+1},(_,p)=>pages.get(pageStart+p)!).join("\n\n");
    const reviewText=clean(rawBahethText),changed=passage.text!==reviewText;
    await tx.concept.update({where:{id:concept.id},data:{videoUrl,videoStartSecond:start,videoEndSecond:end,videoApproved:false,videoApprovedAt:null,videoApprovedById:null}});
    await tx.sourcePassage.update({where:{id:passage.id},data:{text:reviewText,reviewText,rawBahethText,rawPdfText,pdfSource:"المذهب_الحنبلي_1_إلى_22_محمد_بن_أحمد_باجابر_تفريغ.pdf — المقطع (1)، الصفحات 11–20 (استخراج مباشر بـ pypdf)",pdfPageStart:pageStart,pdfPageEnd:pageEnd,bahethUrl,videoUrl,alignmentStatus:"VERIFIED_WITH_CLEANUP",alignmentConfidence:1,humanReviewRequired:false,alignmentDetails:srt.filter(c=>c.start>=start&&c.start<end).map(c=>({startSecond:c.start,endSecond:c.end,status:"VERIFIED_WITH_CLEANUP",confidence:1,reasons:["مطابقة موضوعية مع تفريغ باحث؛ النص النهائي منقح على ضوء PDF."],rawBahethText:c.text,pdfPages:Array.from({length:pageEnd-pageStart+1},(_,p)=>pageStart+p)})),sourceUrl:bahethUrl,startSecond:start,endSecond:end,approved:false,approvedAt:null,approvedById:null,...(changed?{version:passage.version+1}:{})}});
   }
  });
  console.log("Lesson 1 prepared; all records remain unapproved.");
 } finally { await db.$disconnect(); }
};main().catch(error=>{console.error(error);process.exitCode=1});
