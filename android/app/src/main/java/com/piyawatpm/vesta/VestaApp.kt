package com.piyawatpm.vesta

import android.app.Application

class VestaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: VestaApp
            private set
    }
}
