const fs = require('fs');
const path = require('path')

main().catch((err) => console.log(err));

async function main() {
    let numExamples = 1;
    let numNeighbors = 5;
    let useNegSims = false;
    let threshold = 0.8;
    // modify above var to try more examples
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
    
        for (const [userNum, user] of Object.entries(testProps.user)) {
            let numKnownProducts = user.knownProds.length;
            for (let i=0; i<numKnownProducts; i++) {
                let prodIdx = user.knownProds[i];
                testProps.currentLeftOutProd = prodIdx;
                const originalDev = user.ratingDeviation;
                const originalAvg = user.avgRating;
                const origProds = [...user.knownProds];
                user.knownProds.splice(i, 1) //remove the current left out from known
                testProps = leaveOneOut(testProps, user, testProps.currentLeftOutProd) //adjust the average rating and deviations to leave out the current index
                testProps = calcUserSimilarities(testProps, user, userNum) //galc user similarites as if the current index is unknown
                testProps = calcUserPredictions(testProps, user, prodIdx, numNeighbors, useNegSims, threshold); //calc the single prediction value for the current index
                //user.knownProds.splice(prodIdx, 0, prodIdx); //put back 
                user.knownProds = origProds;
                user.ratingDeviation = originalDev;
                user.avgRating = originalAvg;
                user.sim = {};
                // change avg and rating dev back to orig
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
        console.log("\nUser-Based Leave-One-Out cross validation with neighbour threshold of" + threshold + "\n")
    } else{
        console.log("\nUser-Based Leave-One-Out cross validation with " + numNeighbors + " neighbors, and " + negSims+ "\n")
    }
}

function calcMAE(testProps) {
    let mae = -1;

    let numerator = 0;
    let denominator = 0
    for (const [userNum, user] of Object.entries(testProps.user)) {
        denominator += Object.keys(user.predRatings).length
        for (const [prodIdx, prediction] of Object.entries(user.predRatings)) {
            numerator += Math.abs(prediction - user.ratings[prodIdx]);
        }
    }
    mae = numerator / denominator
    console.log("MAE: " + mae + "\n");
}

// parse different properties of input file and return object
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
    return testProps
}

function leaveOneOut(testProps, user, currentLeftOutProd){
    //adjust current user's average and rating deviation to be without current product
    let numKnownProducts = user.knownProds.length;
    
    user.avgRating = user.knownProds.reduce((acc, currVal) => acc + user.ratings[currVal], 0) / numKnownProducts;
    user.ratingDeviation = {};
    user.knownProds.map(function (x) {
        user.ratingDeviation[x] =  user.ratings[x] - user.avgRating
    });
    
    return testProps
}

function calcUserSimilarities(testProps, currUser, userNum) {
    
    for (let i = 0; i < Object.keys(testProps.user).length; i++) {
        
        // calc numerator
        // if comparing to self or has similarity to other user already 
        if (i == userNum) {
            continue;
        }
        //make sure this works
        const intersection = currUser.knownProds.filter(element => testProps.user[i].knownProds.includes(element));
        if (intersection.length == 0){
            continue;
        }
        let numerator = intersection.reduce(function (acc, currVal) {
            return acc + currUser.ratingDeviation[currVal] * testProps.user[i].ratingDeviation[currVal];
        } ,0);
        //calc denominator
        let denomA = Math.sqrt(intersection.reduce(function (acc, currVal) {
                return acc + (currUser.ratingDeviation[currVal] ** 2);
                    }, 0));
        
        let denomB = Math.sqrt(intersection.reduce(function (acc, currVal) {
            return acc + (testProps.user[i].ratingDeviation[currVal] ** 2);
                    }, 0));

        let sim = numerator / (denomA * denomB)
        //set similarities for two users being evaluated
        currUser.sim[i] = sim;
    }
    return testProps;
}

function calcUserPredictions(testProps, user, prodIdx, numNeighbors, useNegSims, threshold) {
    // check if user has existing ratings to simulate
    // add threshold ability
    let neighbors = []
    let nearestNeighbours = []
    if (numNeighbors == -1) {
        nearestNeighbours = getNeighboursThreshold(user, threshold);
    } else{
        neighbors = getKNeighbours(user, useNegSims);
        nearestNeighbours = neighbors.filter((neighbor) => testProps.user[neighbor[0]].ratingDeviation.hasOwnProperty(prodIdx)).slice(0, numNeighbors);
    }

    let numerator = nearestNeighbours.reduce((acc, currVal) => acc + currVal[1] * testProps.user[currVal[0]].ratingDeviation[prodIdx],0 );
    let denominator = nearestNeighbours.reduce((acc, currVal) => acc + currVal[1], 0);
    let predValue = user.avgRating + numerator / denominator;

    const origPredValue = predValue;
    predValue = predValue<1 ? 1 : predValue;
    predValue = predValue>5 ? 5 : predValue;
    predValue = isNaN(predValue) || !isFinite(predValue) ? user.avgRating : predValue;
    user.predRatings[prodIdx] = predValue;
    //logPred(testProps, user, prodIdx, nearestNeighbours, origPredValue, predValue)
    return testProps;
}

// function logPred(testProps, user, prodIdx, nearestNeighbours, origPredValue, predValue){
//     console.log("Predicting for user " + user.name);
//     console.log("Predicting for item " + testProps.productsNames[prodIdx]);
//     console.log("Found " + nearestNeighbours.length + " valid neighbours");
//     for (let i=0; i<nearestNeighbours.length; i++){
//         console.log((i + 1) + ". " + testProps.user[nearestNeighbours[i][0]].name + ", sim = " + nearestNeighbours[i][1]);
//     }
//     console.log("The initial predicted value was " + origPredValue.toFixed(2));
//     console.log("The final predicted value was " + predValue.toFixed(2));
//     console.log("");

// }

function getKNeighbours(user, useNegSims){
    let neighbours = Object.entries(user.sim)
    neighbours.sort((a, b) => b[1] - a[1]);
    if (!useNegSims) {
        neighbours = neighbours.filter((neighbour) => neighbour[1] > 0);
    }
    return neighbours
}

function getNeighboursThreshold(user, threshold){
    let neighbours = Object.entries(user.sim)
    neighbours.sort((a, b) => b[1] - a[1]);
    neighbours = neighbours.filter(function (neighbour) {
        return neighbour[1] >= threshold;
    })
    return neighbours
}