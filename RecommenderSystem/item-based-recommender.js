const fs = require('fs');
const { default: test } = require('node:test');
const path = require('path')

main().catch((err) => console.log(err));

async function main() {
    let numExamples = 1;
    let numNeighbors = 5;
    let useNegSims = false;
    let threshold = 0.8;

    for (let i = 0; i < numExamples; i++) {

        //to run small set of examples
        let testPath = path.join(process.cwd(), "examples", "test" + i + ".txt");

        // to run BIG example
        testPath = path.join(process.cwd(), "examples", "example.txt");

        //to run A2 example 
        //testPath = path.join(process.cwd(), "examples", "sample-data.txt");

        let inputFile = fs.readFileSync(testPath, "utf8");
        let testProps =  parseFile(inputFile);
        testProps.testNumber = i;
        
        startLog(numNeighbors, useNegSims, threshold)
        console.time("Execution Time")
        
        for (const [prodIdx, prod] of Object.entries(testProps.products)) {
            let numRatings = prod.ratedBy.length
            for (let j = 0 ; j < numRatings; j++) {
                let userIdx = prod.ratedBy[j]
                let user = testProps.user[userIdx]
                const originalDev = user.ratingDeviation;
                const originalAvg = user.avgRating;
                const origProds = [...user.knownProds];
                const origRatedBy = [...prod.ratedBy];
                prod.ratedBy.splice(j, 1)
                user.knownProds.splice(j, 1) //remove the current left out from known
                testProps = leaveOneOut(testProps, user)
                testProps = calcProdSimilarities(testProps, prod, prodIdx)
                testProps = calcProdPrediction(testProps, prod, userIdx, prodIdx, numNeighbors, useNegSims, threshold)
                user.knownProds = origProds;
                user.ratingDeviation = originalDev;
                user.avgRating = originalAvg;
                prod.ratedBy = origRatedBy;
                prod.sim = {};
            }
        }
        console.timeEnd("Execution Time")
        calcMAE(testProps);

    }
}

function startLog(numNeighbors, useNegSims, threshold){
    negSims = ""
    if (useNegSims){
        negSims = "including negative similartiy values."
    } else{
        negSims = "NOT including negative similarity values."
    }
    if (numNeighbors == -1) {
        console.log("\nItem-Based Leave-One-Out cross validation with neighbour threshold of" + threshold + "\n")
    } else{
        console.log("\nItem-Based Leave-One-Out cross validation with " + numNeighbors + " neighbors, and " + negSims+ "\n")
    }
}


function calcMAE(testProps) {
    let mae = -1;

    let numerator = 0;
    let denominator = 0
    for (const [userNum, user] of Object.entries(testProps.user)) {
        denominator += Object.keys(user.knownProds).length
        for (const [prodIdx, prediction] of Object.entries(user.predRatings)) {
            numerator += Math.abs(prediction - user.ratings[prodIdx]);
        }
    }
    mae = numerator / denominator
    console.log("MAE: " + mae + "\n");
}

function parseFile(file) {
    let testProps = {}
    let lines = file.split("\n");
    // get dimension values
    let dimensions = lines[0].split(" ");
    testProps.numUsers = parseInt(dimensions[0]);
    testProps.numProducts = parseInt(dimensions[1]);
    //get users and products for printing output
    testProps.userNames = lines[1].trim().split(" ");
    testProps.productsNames = lines[2].trim().split(" ");
    // user ratings for products
    testProps.user = {};
    testProps.products = {}

    //start at 3 since 4th item of lines is first review row
    //iterate until all review rows obtained
    for (let i = 3; i < testProps.numUsers + 3; i++) {
        let ratingLine = lines[i];
        let userNum = i-3;
        testProps.user[userNum] = {}
        testProps.user[userNum].name = testProps.userNames[userNum];
        //parse ratings to int
        testProps.user[userNum].ratings = ratingLine.split(" ").filter((x) => !(x == "")).map((x) => Number(x));
        testProps.user[userNum].sim = {}
    }
    // iterate over users with [key, vals]
    for (const [userNum, user] of Object.entries(testProps.user)) {
        user.unknownProds = [];
        user.knownProds = [];
        user.predRatings = {};
        //determine a user's known and unknown products and add them to user obj
        for (const [idx, val] of user.ratings.entries()) {
            if (val == 0) {
                user.unknownProds.push(idx);
            } else {
                user.knownProds.push(idx); //also keeping track of known prods now
            }
        }
        //compute a user's avg rating with all known products accounted for
        user.avgRating = user.knownProds.reduce((acc, currVal) => acc + user.ratings[currVal], 0) / user.knownProds.length;
        user.ratingDeviation = {};
        user.knownProds.map(function (x) {
            user.ratingDeviation[x] =  user.ratings[x] - user.avgRating
        });
    }
    for (let i = 0; i < testProps.numProducts; i++) {
        testProps.products[i] = {};
        testProps.products[i].name = testProps.productsNames[i];
        testProps.products[i].ratedBy = []
        testProps.products[i].sim = {}
        for (const [userNum, user] of Object.entries(testProps.user)) {
            if (user.knownProds.includes(i)) {
                testProps.products[i].ratedBy.push(userNum)
            }
        }
    }
    return testProps
}

function leaveOneOut(testProps, user){
    //adjust current user's average and rating deviation to be without current product
    let numKnownProducts = user.knownProds.length;
    
    user.avgRating = user.knownProds.reduce((acc, currVal) => acc + user.ratings[currVal], 0) / numKnownProducts;
    user.ratingDeviation = {};
    user.knownProds.map(function (x) {
        user.ratingDeviation[x] =  user.ratings[x] - user.avgRating
    });
    
    return testProps
}

function calcProdSimilarities(testProps, currProd, prodNum) {
    for (let i = 0 ; i < testProps.numProducts; i++){
        if (i == prodNum){
            continue;
        }

        const intersection = currProd.ratedBy.filter(element => testProps.products[i].ratedBy.includes(element));
        if (intersection.length == 0){
            continue;
        }

        let numerator = intersection.reduce(function (acc, currVal){
            return acc + (testProps.user[currVal].ratingDeviation[prodNum]) * (testProps.user[currVal].ratingDeviation[i])
        }, 0)

        let denomA = Math.sqrt(intersection.reduce(function (acc, currVal){
            return acc + (testProps.user[currVal].ratingDeviation[prodNum] ** 2) 
        }, 0))

        let denomB = Math.sqrt(intersection.reduce(function (acc, currVal){
            return acc + (testProps.user[currVal].ratingDeviation[i] ** 2) 
        }, 0))

        let sim = numerator / (denomA * denomB);
        currProd.sim[i] = sim;
    }
    return testProps
}

function calcProdPrediction(testProps, prod, userIdx, prodIdx, numNeighbors, useNegSims, threshold) {
    // add threshold ability
    //filter((neighbor) => testProps.user[neighbor[0]].ratingDeviation.hasOwnProperty(prodIdx))
    let neighbors = []
    let nearestNeighbours = []
    if (numNeighbors == -1) {
        nearestNeighbours = getNeighboursThreshold(prod.sim, testProps.user[userIdx], threshold)
    }
    else {
        neighbors = getKNeighbours(prod.sim, testProps.user[userIdx], useNegSims);
        nearestNeighbours = neighbors.slice(0, numNeighbors);
    }
    let numerator = nearestNeighbours.reduce((acc, currVal) => acc + prod.sim[currVal[0]] * testProps.user[userIdx].ratings[currVal[0]], 0)
    let denominator = nearestNeighbours.reduce((acc, currVal) => acc + prod.sim[currVal[0]], 0)
    let predValue = numerator / denominator

    const origPredValue = predValue;
    predValue = predValue<1 ? 1 : predValue;
    predValue = predValue>5 ? 5 : predValue;
    predValue = isNaN(predValue) || !isFinite(predValue) ? testProps.user[userIdx].avgRating : predValue;

    testProps.user[userIdx].predRatings[prodIdx] = predValue;
    //logPred(testProps, testProps.user[userIdx], prodIdx, nearestNeighbours, origPredValue, predValue)
    return testProps;
}

// function logPred(testProps, user, prodIdx, nearestNeighbours, origPredValue, predValue){
//     console.log("Predicting for user " + user.name);
//     console.log("Predicting for item " + testProps.productsNames[prodIdx]);
//     console.log("Found " + nearestNeighbours.length + " valid neighbours");
//     for (let i=0; i<nearestNeighbours.length; i++){
//         console.log((i + 1) + ". " + testProps.productsNames[nearestNeighbours[i][0]] + ", sim = " + nearestNeighbours[i][1]);
//     }
//     console.log("The initial predicted value was " + origPredValue.toFixed(2));
//     console.log("The final predicted value was " + predValue.toFixed(2));
//     console.log("");
// }

function getKNeighbours(sims, user, useNegSims){
    let neighbours = []
    let simValues = Object.entries(sims)
    neighbours = simValues.filter(function (neighbour) {
        return user.ratings[neighbour[0]] != 0
    })
    neighbours.sort((a, b) => b[1] - a[1]);
    if (!useNegSims) {
        neighbours = neighbours.filter((neighbour) => neighbour[1] > 0);
    }
    return neighbours
}

function getNeighboursThreshold(sims, user, threshold) {
    let neighbours = []
    let simValues = Object.entries(sims)
    neighbours = simValues.filter(function (neighbour) {
        return user.ratings[neighbour[0]] != 0
    })
    neighbours = neighbours.filter(function (neighbour) {
        return neighbour[1] >= threshold;
    })
    neighbours.sort((a, b) => b[1] - a[1]);
    return neighbours
}