import path from 'node:path';
import { createApplication, root } from '../服务端/应用.mjs';

const application = createApplication({ dataDir:path.join(root,'验收输出','模型管理预览'),env:{},startJobs:false });
application.app.listen(5301,'127.0.0.1',()=>console.log('模型管理独立预览：http://127.0.0.1:5301/'));
