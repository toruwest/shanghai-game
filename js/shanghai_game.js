
const gameStatusKey_layout = "shanhai-game-status-layout";
const gameStatusKey_history = "shanhai-game-status-history";
const gameStatusKey_position = "shanhai-game-status-position";
const gameStatusKey_count = "shanhai-game-status-count";
const gameStatusKey_starttime = "shanhai-game-status-starttime";

//var storage = sessionStorage;
//以下は都合によりshanghai_common.jsで宣言
storage = sessionStorage;
//var layoutFromQuery;

//クリックされたときにセットされる。
var firstPieceID;

var histories = [];
var currentHistoryPos = 0;
//操作回数を保持。牌を消したときとundoしたときに増やし、newGame()でクリアすること
var operationCount = 0;
var gameStartTimeString;

var language = (window.navigator.language ||  window.navigator.userLanguage || window.navigator.browserLanguage);

if(language==='ja') {
    $("#btn_reset_view").text('視野を最初の状態に戻す');
    $("#btn_newgame").text('新しくゲームを始める');
    $("#sliderText").text('元に戻す / やり直す');
} else {
    $("#btn_reset_view").text('Reset the view');
    $("#btn_newgame").text('Start new game');
    $("#sliderText").text('UNDO / REDO');
}

//実行開始位置
$(function () {
    //これだけはinitGL()に移せない。
    texLoader = new THREE.TextureLoader();

    container = $("#container");

    $("#btn_undo").on( 'click', function () {
        undo();
    });
    $("#btn_reset_view").on( 'click', function () {
        resetView();
    });
    $("#btn_newgame").on( 'click', function () {
        var confirm;
        if(language == 'ja') {
            confirm = "本当に新しいゲームを始めますか？";
        } else {
            confirm = "Are you surely start new game?";
        }
        var ans = window.confirm(confirm);
        if (ans) {
            var gameOverText = makeGameOverText(false);
            console.log(gameOverText);
            sendGameStateToServer(gameOverText);

            newGame();
        }
    });
    //sliderの変化は直接イベントハンドラーを指定している。
    //                $("#slider").on('click'), function() {
    //                    console.log("slider clicked");
    //                    $("#sliderLabel").text($("#slider").value);
    //                };

    //リクエストパラメータに牌の配置情報が含まれていたら復元
    //書式は、"?layout=[0,1,2...]"　(但し","は"%2C", "="は"%3A", "["は"%5B", "]"は"%5D"にURLエンコードされる)
    findLayoutInQuery();

    layoutPieces(true);

    loadImages(function () {
        console.log("image loaded");
        initGL();
        //event handling
        window.addEventListener( 'resize', onWindowResize, false );
        //rangeによる入力ができるよう、GLのキャンバス外でのイベントを扱わないようにする。
        renderer.domElement.addEventListener('mousedown', onDocumentMouseDown, false);
        animate();
    });
    // historyも復元
    restoreHistories();
});

function onDocumentMouseDown(event) {
    var rect = event.target.getBoundingClientRect();
    //console.log("clientrect:" + rect.left + "/" + rect.top);
    //var clientMouseX = event.clientX-rect.left;
    //var clientMouseY = event.clientY-rect.top;
    //console.log("client x/y:" +  event.clientX + "/" +  event.clientY);
    //上と下は同じ値。
    //console.log("page x/y:" +  event.pageX + "/" +  event.pageY);
    //console.log("client-container x/y:" + (event.clientX - 20) + "/" + (event.clientY - 45));
    //console.log("rect - mouse:" + clientMouseX + "/" + clientMouseY);
    event.preventDefault();
    mouse.set( ( (event.clientX - rect.left) / window.innerWidth ) * 2 - 1, - ( (event.clientY - rect.top) / window.innerHeight ) * 2 + 1 );
    raycaster.setFromCamera( mouse, camera );
    //以下は、meshesの後にtrue/false(recursiveかどうかを指定する)こともできるが、あってもなくても同じ結果になった。
    var intersects = raycaster.intersectObjects( meshes);
    if ( intersects.length === 0 ) return;

    //複数のmeshが返されるので、いちばん近いのを採用する。0に入っている。
    //console.log("intersects[0]" + intersects[0]);

    //pieceIDは自分で設定したものだが、Three.jsでname,idなどのプロパティがあるので、これを使えるかもしれない。
    var pieceID = intersects[0].object['pieceID'];
    var pos = pieceAtPosition.indexOf(pieceID);
    console.log("x/y:" + mouse.x + "/" + mouse.y + ", picked cube's id:" + pieceID + ", name:" + pieces[pieceID] + ", pos:" + pos);
    //dumpPosRelation(pos, false, true);

    if (pieceID !== -1) {
        //クリックされた牌の種類を記録。1回目と2回目の絵柄が同じなら非表示にする。全て非表示になったらゲームオーバー。UNDOで復活(非表示を止める)
        if(firstPieceID || firstPieceID === 0) {
            if(firstPieceID === pieceID) {
                //同じ牌をクリックされたら選択解除
                firstPieceID = null;
                //強調表示を解除。
                hilightPiece(pieceID, false);
                return;
            } else {
                if(isSelectable(pieceID)) {
                    hilightPiece(pieceID, true);
                    console.log(pieceID + "は消せます");

                    //"ap5","pz1"などの文字列を比べることにより、同じ絵柄かチェックする。"wz5"と"aw5"は色違いで、別の牌として扱う。
                    if(pieces[firstPieceID] === pieces[pieceID]) {
                        // 該当の牌を非表示にする。
                        meshes[firstPieceID].visible = false;
                        meshes[pieceID].visible = false;
                        hilightPiece(firstPieceID, false);
                        hilightPiece(pieceID, false);
                        console.log(firstPieceID + "と" + pieceID + "を非表示にしました。");
                        operationCount++;
                        $("#text_count").text(operationCount);

                        //履歴に記録。
                        if (currentHistoryPos === histories.length) {
                            histories.push(new HistoryInfo(firstPieceID, pieceID));
                        } else {
                            //いったんUNDOした後に通常の操作により牌を消した場合、それ以降の履歴は
                            //消去して、それまでの履歴の後に今回の操作を追加していく。
                            //ここでは、簡単に実装するため、一時的に他の変数にコピーしておいて、
                            //空にしたhistoriesに、先頭から該当位置までの履歴をコピーする。
                            var tmpHistories = [];
                            for(var i = 0; i < currentHistoryPos; i++) {
                                tmpHistories.push(histories[i]);
                            }
                            histories = tmpHistories;
                            histories.push(new HistoryInfo(firstPieceID, pieceID));
                        }
                        currentHistoryPos = histories.length;
                        //$("#sliderLabel").text(currentHistoryPos);
                        //TODO 以下でイベントが起きないか？
                        $("#slider").prop('max', currentHistoryPos);
                        $("#slider").prop('value', currentHistoryPos);

                        //historyを保存。リロード時に復元される。
                        storage.setItem(gameStatusKey_history, JSON.stringify(histories));
                        storage.setItem(gameStatusKey_position, currentHistoryPos);
                        storage.setItem(gameStatusKey_count, operationCount);

                        hilightPiece(firstPieceID, false);
                        //この上下の順番に注意
                        firstPieceID = null;
                        render();
                        //ゲームオーバー？
                        checkAllPiecesInvisible();
                    } else {
                        //最初にクリックした牌と２番目にクリックした牌の絵柄が合わない。
                        //このような場合、後でクリックした牌を選択したことにする。

                        hilightPiece(firstPieceID, false);
                        hilightPiece(pieceID, true);
                        //この順番に注意
                        firstPieceID = pieceID;
                        render();
                    }
                } else {
                    hilightPiece(firstPieceID, false);
                    //この上下の順番に注意
                    firstPieceID = null;
                }
            }
        } else {
            if(isSelectable(pieceID)) {
                firstPieceID = pieceID;
                //この上下の順番に注意
                hilightPiece(pieceID, true);
                //クリックされた牌を強調表示。
                render();
                console.log(pieceID + "は消せます");
            }
        }
    }
}

//全て非表示になったらゲームオーバー。
function checkAllPiecesInvisible() {
    if(histories.length * 2 === pieces.length) {
        if(language === 'ja') {
            alert("おめでとうございます。");
        } else {
            alert("Congratulations!");
        }

        //TODO 新しいゲームを始める前に、クリアしたゲームの配置を保存したい。
        //保存する方法としては、Webサーバー側に送って保存してもらうことを考えている。
        //macOSのApacheではアクセスログに保存されることを確認した。
        //Androidの場合、使っているNano http server(MyWebServer.java)を改造して、
        //特定のキーワードを含む場合、LOG.d()ではなくファイルに保存する。

        //なお、リプレイできるようにするためには、複数の候補から一つ選ぶようなUIと、
        //ゲームの状態をサーバーからダウンロードしてブラウザ側で復元する操作が必要となる。
        //TODO GETのパラメーターとして、生成した牌の配置を送り、ブラウザ側はこれを使って
        //レンダリングするように改造する。これによりブックマーク可能になり、
        //また、サーバー側でPHPやJSFなどの仕組みがなくても良い。

        //TODO ゲーム終了時に、断念したか、クリアしたかと、それまでの時間と手数を記録する
        //これらも、ゲーム開始時と同様にサーバー側に送り、記録してもらう。
        //TODO ゲーム開始時に、駒の配置をJSON化したものを送っているが、これを終了時に再び送るのは
        //冗長なので、ゲーム開始時刻を送る。
        //TODO ゲームを人間が解くのではなく、ソフトで出来ないか？(UIなし)
        //TODO ピンポンゲームを機械学習で解けないか？画像から。
        var gameOverText = makeGameOverText(true);
        console.log(gameOverText);
        sendGameStateToServer(gameOverText);
        newGame();
    }
}

function makeGameOverText(isGameCleared) {
    return "end:" + getCurrentDateString() + ", " + generateGameScore(isGameCleared, operationCount) + ", started:" + gameStartTimeString;
}

function restoreHistories() {
    var historiesTmp = storage.getItem(gameStatusKey_history);
    var currentHistoryPosTmp = storage.getItem(gameStatusKey_position);
    var operationCountTmp = storage.getItem(gameStatusKey_count);
    var gameStartTimeStringTmp = storage.getItem(gameStatusKey_starttime);

    if(historiesTmp) {
        //このままではHistoryInfoクラスではなくObjectクラスになるので、HistoryInfoクラスに変換。
        var historiesObj = JSON.parse(historiesTmp);
        for(var o of historiesObj) {
            histories.push(new HistoryInfo(o['firstMeshId'], o['secondMeshId']));
        }
        if(currentHistoryPosTmp) {
            currentHistoryPos = parseInt(currentHistoryPosTmp);
        } else {
            currentHistoryPos = histories.length;
        }
        if(operationCountTmp) {
            operationCount = parseInt(operationCountTmp);
        } else {
            operationCount = 0;
        }
        $("#text_count").text(operationCount);

        if(gameStartTimeStringTmp) {
            gameStartTimeString = gameStartTimeStringTmp;
        } else {
            gameStartTimeString = getCurrentDateString();
        }

        console.log("histories size:" + histories.length + ", pos:" + currentHistoryPos + ", operationCount:" + operationCount + ", start:" + gameStartTimeString);

        //スライダー(range)の現在値と最大値を更新。
        $('#slider').prop('max', histories.length);
        $("#slider").prop('value', currentHistoryPos);
        //                    $("#sliderLabel").text(currentHistoryPos);

        //http://stackoverflow.com/questions/30304156/dynamically-set-html5-range-slider-min-max-and-step-values

        //画面上の牌の状態を更新
        for(var pair of histories) {
            if(pair) {
                var first = pair['firstMeshId'];
                var second = pair['secondMeshId'];
                meshes[first].visible = false;
                meshes[second].visible = false;
            }
        }
    }

    if(histories === null) histories = [];
}

function undo() {
    console.log("undo button clicked");
    //undoしたときでも増やす!
    operationCount++;
    $("#text_count").text(operationCount);

    currentHistoryPos--;
    //pop()だとREDOできないが、これで良しとする。sliderを使えばredoできる。
    var pair = histories.pop();
    //storageに保存する。
    storage.setItem(gameStatusKey_history, JSON.stringify(histories));
    storage.setItem(gameStatusKey_position, currentHistoryPos);
    storage.setItem(gameStatusKey_count, operationCount);
    //                $('#slider').prop('max', histories.length);
    $("#slider").prop('value', currentHistoryPos);
    //                $("#sliderLabel").text(currentHistoryPos);
    setPairVisibleStatus(pair, true);
}

function onSliderChanged(valueStr) {
    //historiesそのものは変えないで、これへのインデックスだけを更新する。
    //左側へのスライドにより、UNDOを実現し、
    //右側にスライドすることにより、前の操作を復元して、REDOを実現する。
    //牌を消去する操作を行ったときに、これより後のREDOはできなくする。
    var value = parseInt(valueStr);

    //操作回数はundoしたときでも増やす!
    operationCount++;
    $("#text_count").text(operationCount);

    if(value < currentHistoryPos) {
        currentHistoryPos--;
        var pair = histories[currentHistoryPos];
        setPairVisibleStatus(pair, true);
        storage.setItem(gameStatusKey_position, currentHistoryPos);
        storage.setItem(gameStatusKey_count, operationCount);
    } else if(currentHistoryPos < value && currentHistoryPos < histories.length - 0) {
        var pair = histories[currentHistoryPos++];
        setPairVisibleStatus(pair, false);
        storage.setItem(gameStatusKey_position, currentHistoryPos);
        storage.setItem(gameStatusKey_count, operationCount);
    }
    $("#slider").prop('value', currentHistoryPos);
}

function newGame() {
    //WebStorageをクリア
    clearGameState();

    //クエリーパラメーターを取り除く。
    var q = location.search;
    var newURL = window.location.href;
    var queryIndex = newURL.indexOf('?');
    newURL = newURL.substring(0, queryIndex);
    console.log("will move to page: " + newURL);

    setTimeout(function(){
        //window.location.reload(true);
        //window.location.href().reload(true);
        //クエリーパラメーターを取り除いたページに遷移。
        window.location.assign(newURL);
    }, 3000);
}

function clearGameState() {
    storage.removeItem(gameStatusKey_layout);
    storage.removeItem(gameStatusKey_history);
    storage.removeItem(gameStatusKey_count);
    storage.removeItem(gameStatusKey_starttime);
    currentHistoryPos = 0;
    operationCount = 0;
    $("#text_count").text(operationCount);
}

function generateGameScore(isGameCleared, count) {
    console.log("count:" + count);
    if(isGameCleared) {
        return "clear, count:" + count;
    } else {
        return "giveup, count:" + count;
    }
}

function sendGameStateToServer(text) {
    //以下は/var/log/apache2/access_log, あるいは /private/var/log/apache2/access_logにURLエンコーディングされて記録されることを確認済み。
    //AndroidのNanoHttpdでも受信できた。status 404(not found)エラーを避けるため、dummy.pngは実在するファイル(1x1ピクセルの画像)にした。
    $.ajax({
        url: "./img/dummy.png",
        method: "GET",
        data: { text },
    });
}