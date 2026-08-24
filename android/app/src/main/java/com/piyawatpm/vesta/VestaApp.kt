package com.piyawatpm.vesta

import android.app.Application
import com.piyawatpm.vesta.data.PendingQueue
import com.piyawatpm.vesta.data.VestaStore

class VestaApp : Application() {

    /** The app-wide store — created once, shared by every screen and the
     *  background refresh worker. */
    val store: VestaStore by lazy { VestaStore(this) }

    /** The offline quick-add queue (shares the store's Supabase client). */
    val pendingQueue: PendingQueue by lazy { PendingQueue(this, store.api) }

    override fun onCreate() {
        super.onCreate()
        instance = this
        com.piyawatpm.vesta.work.BackgroundRefresh.schedule(this)
    }

    companion object {
        lateinit var instance: VestaApp
            private set
    }
}
