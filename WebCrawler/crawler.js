const Crawler = require("crawler");
const express = require('express');
const mongoose = require("mongoose");
const PageModel = require("./PageModel");
const elasticlunr = require("elasticlunr");
const {Matrix} = require("ml-matrix");
const path = require("path");
const axios = require('axios');

const app = express();
app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"))

const connectString = "mongodb://127.0.0.1:27017/A1";
initDB().catch((err) => console.log(err));

crawledDomains = 0;
startingFruitURL = "https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html"
startingPersonalURL = "https://www.budgetbytes.com"

async function initDB() {
    let testing = false;
    await mongoose.connect(connectString, {useNewUrlParser: true});
    //drop existing database before init
    if (!testing) {
        await mongoose.connection.db.dropDatabase();
        startCrawler(startingFruitURL, "fruits");
    }
    else {
        fruitsIndex = await createIndex("fruits");
        personalIndex = await createIndex("personal");
        app.listen(3000);
        console.log("Server listening at http://localhost:3000\n");
    }
}

async function startCrawler(startUri, domain) {
    let queuedLinks = new Set();
    let pages = [];
    queuedLinks.add(startUri);

    const c = new Crawler({
        maxConnections : 10,
        pages:pages,
        callback: async function (err, res, done) {
            if(err){
                console.log(err);
            }
            else {
                let $ = res.$;
                
                let page = {
                    url: res.options.uri,
                    title: $("title").text(),
                    paragraph: $("p").text() + " ",
                    outgoingLinks: [],
                    domain: domain,
                }
                
                let links = $("a");
                let linkQueue = [] ;
                $(links).each(async function(i, link) {
                    let pathToAbsolute;
                    let absoluteLink;
                    if (domain == 'personal'){ // handling personal domain
                        oldCrawler = false;
                        if ($(link).attr('href') && !oldCrawler){
                            if ($(link).attr('href').startsWith('https://www.budgetbytes.com')){
                                absoluteLink = $(link).attr('href');
                            }
                        }

                    }else { //normal handling for fruits domain 
                        pathToAbsolute = res.options.uri.split("/").slice(0, -1).join("/");
                        absoluteLink = pathToAbsolute + $(link).attr('href').substring(1);
                    }
                    
                    if (!queuedLinks.has(absoluteLink) && (absoluteLink!=undefined) ) {
                        queuedLinks.add(absoluteLink);
                        linkQueue.push(absoluteLink);
                        
                    }
                    if (absoluteLink!=undefined) {
                        page.outgoingLinks.push(absoluteLink);
                    }
                });
                if (res.options.pages.length + c.queueSize + linkQueue.length <= 1000) {
                    c.queue(linkQueue);
                }
                res.options.pages.push(page);
            }
            done();
        }
    })

    //start crawler by queuing root page
    c.queue(startUri);
    c.on('drain', async () => {
        console.log("Completed crawl for: "  + domain)
        if (crawledDomains < 1) {
            startCrawler(startingPersonalURL, "personal");
        }
        pages = await buildNetwork(pages);
        await saveNetwork(pages, domain);
    });
}
async function buildNetwork(pages) {
    for (let i = 0; i < pages.length;i++) {
        let incomingLinks = [];
        for (let j = 0; j < pages.length; j++) {
            if (pages[j].outgoingLinks.includes(pages[i].url)) {
                incomingLinks.push(pages[j].url);
            } 
        }
        pages[i].incomingLinks = incomingLinks;
    }
    return pages
}

async function saveNetwork(pages, domain) {
    await PageModel.create(pages);
    if (domain == "fruits") {
        fruitsIndex = await createIndex(domain);
    }
    else {
        personalIndex = await createIndex(domain);
    }
    console.log("Created index for: " + domain)
    await calcPageRank(domain);
    crawledDomains++;
    if (crawledDomains > 1) {
        app.listen(3000);
        console.log("Server listening at http://localhost:3000\n");
        /* Not needed since already registered with server
        axios({
            method: 'put',
            url: 'http://134.117.130.17:3000/searchengines',
            headers: {'Content-Type': 'application/json'},
            data: {
                request_url:'http://134.117.130.93:3000'
            }
        })
        .then((response) => console.log(response));
        */
    }
}

async function createIndex(domain) {
    let index = elasticlunr(function () {    //create the elasticlunr index
        this.addField('url');
        this.addField('title');
        this.addField('paragraph');
        this.setRef('_id');
      });


    let pagesList = await PageModel.find({},{_id:1,url: 1, title:1, paragraph:1}).where("domain").equals(domain);     //load db into index
    pagesList.forEach(element=> {
        const tempObj = {
            _id: element._id,
            title: element.title,
            paragraph: element.paragraph,
            url: element.url
        }
        index.addDoc(tempObj);
    });
    return index;
}

async function calcPageRank(domain) {
    let pagesList = await PageModel.find({}).where("domain").equals(domain);
    const N = pagesList.length;
    let adjacencyMatrix = Matrix.zeros(N, N);
    let steadyVector = Matrix.zeros(1, N);
    steadyVector.set(0,0,1);
    const alpha = 0.1;

    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            if (pagesList[i].outgoingLinks.includes(pagesList[j].url)) {
                adjacencyMatrix.set(i,j,1);
            }
        }
    }

    for(let i = 0; i < adjacencyMatrix.rows; i++) { //go through rows
        let currRow = adjacencyMatrix.getRow(i);
        if(!currRow.includes(1)) { //if a certain row has anything but 0
            for (let j = 0; j < N; j++) { 
                currRow[j] = 1/N;
            }
            adjacencyMatrix.setRow(i,currRow);
        }else if(currRow.includes(1)) { 
            let onesCount = 0;
            for (let j=0; j < N; j++) {
                if(currRow[j] === 1) { 
                    onesCount++;
                }
            }
            let denominator = 1 / onesCount;
            for (let j=0; j < N; j++) {
                if (currRow[j] == 1) {
                    currRow[j] = denominator;
                }
            } 
        }
        adjacencyMatrix.setRow(i, currRow);
    }
    adjacencyMatrix = adjacencyMatrix.mul(1-alpha);
    let addMatrix = Matrix.zeros(N, N);
    addMatrix = addMatrix.fill(1/N);
    addMatrix = addMatrix.mul(alpha);
    adjacencyMatrix = adjacencyMatrix.add(addMatrix);

    let euclid_dist;
    //multiply the vector against our Matrix by some vector 
    do {
        euclid_dist = 0;
        let previousVector = steadyVector.clone(); 
        steadyVector = steadyVector.mmul(adjacencyMatrix);
        euclid_dist = Math.sqrt(steadyVector.data[0].reduce((acc, val, i) => acc + Math.pow(val - previousVector.data[0][i], 2), 0))

    }while ( euclid_dist > 0.0001); //while the euclidiean distance is less than the tx-1

    for (i = 0; i < N; i++) {
        pagesList[i].pr = steadyVector.get(0, i);
        await pagesList[i].save();
    }
    console.log("Generated pageranks for: " + domain)
}

app.get('/', async (req, res)=>{
    res.render('pages/index', {title : 'Homepage'});
});


app.get('/fruits', async (req, res)=>{
    console.log("fruits hit again")
    req.domain = "fruits";
    let searchResults = await getResults(req, res)
    res.format({
        "text/html": function () {
            res.render('pages/results', {title : 'search results', pages: searchResults});
        },
        "application/json": async function () {
            let jsonSearchResults = await jsonFormat(searchResults);
            res.status(200).json(jsonSearchResults);
        },
        //if client request MIME type other than json or html
        default: function () {
          res.status(406).send('Request contained unspported MIME type');
        }
      })
});

app.get('/personal', async (req, res)=>{
    console.log("personal hit again")
    req.domain = "personal";
    let searchResults = await getResults(req, res)
    res.format({
        "text/html": function () {
            res.render('pages/results', {title : 'search results', pages: searchResults});
        },
        "application/json": async function () {
            let jsonSearchResults = await jsonFormat(searchResults);
            res.status(200).json(jsonSearchResults); 
        },
        //if client request MIME type other than json or html
        default: function () {
          res.status(406).send('Request contained unspported MIME type');
        }
      })
});

async function jsonFormat(searchResults) {
    let jsonSearchResults = [];
    for (let i = 0; i < searchResults.length; i++) {
        let result =  searchResults[i];
        let jsonFormat = {
            name: result.name,
            url: result.url,
            score: result.score,
            title: result.title,
            pr: result.pr
        }
        jsonSearchResults.push(jsonFormat);
    }
    return jsonSearchResults;
}

async function getResults(req, res){
    let keywords = []
    let limit = 10 //max and min not set
    if (req.query.q) {keywords = req.query.q;}
    if (req.query.limit){limit = req.query.limit;}
    console.log(`Querying for top ${limit} pages with query: ${keywords}:`);

    //results
    let indexResults = []
    if (req.domain == 'fruits'){
        indexResults = (fruitsIndex.search(keywords, {}));
    } else if (req.domain == 'personal'){
        indexResults = (personalIndex.search(keywords, {}));
    }
    
    //getting database objects corresponding to the results
    let correspondingPages = [];
    for (let i = 0; i < indexResults.length;i++) {
        let curr = await PageModel.findOne().where("_id").equals(indexResults[i].ref).exec();
        //handling boost
        if (req.query.boost == 'on' || req.query.boost == 'true'){
            curr.searchScore = indexResults[i].score * curr.pr;
        } 
        curr.score = indexResults[i].score;
        correspondingPages.push(curr);
    }

    if (req.query.boost == 'on' || req.query.boost == 'true') {
        correspondingPages.sort((a,b) => {
            if (a.searchScore == b.searchScore) return 0;
            return (a.searchScore < b.searchScore) ? 1: -1;
        });
    }
    else{
        correspondingPages.sort((a,b) => {
            if (a.score == b.score) return 0;
            return (a.score < b.score) ? 1: -1;
        });
    }
    //prune the list to match page limit or fill empty space if needed
    if (correspondingPages.length > limit){
        correspondingPages = correspondingPages.slice(0,limit);
    }else {
        while (correspondingPages.length < limit) {
            let tempPage = await PageModel.find().where('domain').equals(req.domain).limit(50).exec();
            for (let i = 0; i < tempPage.length;i++) {
                //check page is not already in searchResults, if not add it, if limit it reached break
                let hasObj = correspondingPages.findIndex(pg => pg.title == tempPage[i].title)
                if (hasObj == -1) {
                    tempPage[i].score = 0;
                    correspondingPages.push(tempPage[i]);
                }
                if (correspondingPages.length == limit) {
                    break;
                }
            }
        }  
    }
    for (let i = 0; i < correspondingPages.length;i++) {
        delete correspondingPages[i].searchScore;
        correspondingPages[i].save();
    } 
    //console.log(searchResults)
    return correspondingPages
}
app.get('/page/:pageId', (req, res) => {
    let text = req.page.paragraph
    if(!req.page.wordFrequency) { 
        req.page.wordFrequency = {};
        let wordFrequency=countWords(text);
        let pairs = Object.entries(wordFrequency);
        pairs.sort((a, b) => a[1] - b[1]);
        pairs.reverse();
        req.page.wordFrequency = Object.fromEntries(pairs.slice(0,10));
        req.page.save();
    }
    res.render('pages/pageInfo', {page : req.page});
});
app.param("pageId", async function (req, res, next, value) {
    try {
        req.page = await PageModel.findOne().where('title').equals(value);
    } catch (err){
        return res.status(404).send(err.message);
    }
    next()
});

function countWords(str) {
    str = str.toLowerCase();
    if (str.length === 0) {
      return {};
    }
  var output = {};
    var strArr = str.split(" ")
    strArr.map(word => output[word]? output[word]++ : output[word] = 1)
    return output;
  }